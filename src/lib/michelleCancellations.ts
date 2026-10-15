import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import type { PendingItem } from "@/lib/pendingTasks";
import { notifyOwner, resolveNotifications } from "@/lib/notifications";
import { getInventoryLeadId } from "@/lib/guards";
import {
  formatCancelledGuideCode,
  nextCancelledGuideNumber,
} from "@/lib/cancelledGuides";
import { lookupGuide } from "@/lib/localWarranty";
import { autoReingresoReadyCancelledGuides } from "@/lib/inventoryAutoFlows";
import { recomputeAutoFillRate } from "@/lib/autoFillRate";
import { cancelTiming } from "@/lib/michelleCancelTiming";
import {
  trackingFor,
  verifyGuideOwner,
  type GuideCheckResult,
  type VerifiedGuide,
} from "@/lib/provedixGuideCheck";

// Guías canceladas pedidas por el dropshipper en el chat de Michelle
// (provedix.com, pedido del usuario 2026-10-15). Reglas:
// - Bryan Ríos: se aceptan hasta las 11:00 con cualquier transportadora,
//   excepto Veloces hasta las 9:30. Fuera de esa hora y los fines de semana
//   queda a criterio del equipo: Michelle lo pasa SIN prometer nada.
// - Daniel: fuera de horario le llega primero a él para aceptar o rechazar.
//   Joao recibe "retén físicamente la guía"; Daniel y Allan reciben "la guía
//   ha sido retenida por …" (Joao esté o no; ellos también pueden retenerla).
// - La retención exige una foto en vivo. Con eso la guía vuelve sola al
//   Kardex (mismo flujo que las demás guías canceladas) y deja de sumar en
//   Pedidos despachados. El dropshipper ve el resultado y la foto en el chat.

export const MICHELLE_CANCEL_URL = "/area/workspace?tab=egresos&otab=michelle";
export const MICHELLE_CANCEL_REASON =
  "Cancelada por el dropshipper (vía Michelle, chat de provedix.com)";
const HANDLER_USERNAMES = ["joao2026"];
const WATCHER_USERNAMES = ["allan2026"]; // + líder de Inventarios (Daniel)
// Michelle (asesora B2B) solo mira: tiene las fotos como respaldo para atender al dropshipper.
const VIEWER_USERNAMES = ["mramirez"];

const TITLE_RETAIN = "🔴 Guía cancelada: retenla";
const TITLE_APPROVE = "Cancelación fuera de horario por decidir";

// ---- Personas --------------------------------------------------------------

async function idsByUsername(usernames: string[]): Promise<string[]> {
  const rows = await prisma.user.findMany({
    where: { username: { in: usernames }, isActive: true },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}
async function watcherIds(): Promise<string[]> {
  const [extra, lead] = await Promise.all([
    idsByUsername(WATCHER_USERNAMES),
    getInventoryLeadId(),
  ]);
  return [...new Set([...extra, ...(lead ? [lead] : [])])];
}

export type MichelleCancelRole = {
  userId: string;
  canRetain: boolean;
  canDecide: boolean;
};

// Joao retiene; Daniel (líder INV) y Allan también pueden retener (respaldo);
// solo Daniel (o el admin) decide las de fuera de horario.
export async function getMichelleCancelRole(): Promise<MichelleCancelRole | null> {
  const session = await auth();
  if (!session) return null;
  if (session.user.role === "admin")
    return { userId: session.user.id, canRetain: true, canDecide: true };
  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      username: true,
      isActive: true,
      isLeader: true,
      leadsDept: { select: { code: true } },
    },
  });
  if (!me?.isActive) return null;
  const isInvLead = !!me.isLeader && me.leadsDept?.code === "INV";
  const handler = HANDLER_USERNAMES.includes(me.username ?? "");
  const watcher = WATCHER_USERNAMES.includes(me.username ?? "");
  if (!handler && !watcher && !isInvLead)
    return VIEWER_USERNAMES.includes(me.username ?? "")
      ? { userId: session.user.id, canRetain: false, canDecide: false }
      : null;
  return { userId: session.user.id, canRetain: true, canDecide: isInvLead };
}

// ---- Mensajes al chat del dropshipper --------------------------------------

async function tellDropshipper(chatId: string | null, text: string) {
  if (!chatId) return;
  await prisma.provedixChatMessage
    .create({ data: { chatId, role: "assistant", content: text } })
    .catch(() => null);
  await prisma.provedixChat
    .update({ where: { id: chatId }, data: { updatedAt: new Date() } })
    .catch(() => null);
}

// ---- Pedido desde el chat --------------------------------------------------

export type CancelRequestResult =
  | GuideCheckResult
  | {
      resultado: "ya_salio";
      transportadora: string;
      enlace_rastreo: string | null;
    }
  | { resultado: "en_gestion" }
  | { resultado: "fuera_de_horario"; motivo: "hora_limite" | "fin_de_semana" }
  | { resultado: "ya_pedida"; estado: string }
  | { resultado: "primero_dropi" };

const CARRIER_ENUM = (c: string) => {
  const u = c.toUpperCase();
  if (u.includes("SERVI")) return "SERVIENTREGA" as const;
  if (u.includes("URBANO")) return "URBANO" as const;
  if (u.includes("GINTRA")) return "GINTRANCOM" as const;
  if (u.includes("LAAR")) return "LAARCOURIER" as const;
  return "VELOCES" as const;
};

// Marca del reporte: Rocket aparte; si no, la marca de la mayoría de sus productos.
async function sourceAreaOf(row: VerifiedGuide, lineIds: string[]) {
  if (row.batch.source === "ROCKET") return "ROCKET" as const;
  const items = lineIds.length
    ? await prisma.purchaseCatalogItem.findMany({
        where: { id: { in: lineIds } },
        select: { bodega: true },
      })
    : [];
  const tally = new Map<string, number>();
  for (const i of items)
    if (i.bodega) tally.set(i.bodega, (tally.get(i.bodega) ?? 0) + 1);
  const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return top === "MKT_DAMIAN"
    ? ("MKT_DAMIAN" as const)
    : top === "MKT_SHANGHAI"
      ? ("MKT_SHANGHAI" as const)
      : ("MKT_PROVEDIX" as const);
}

export async function requestCancellationFromChat(
  input: {
    guia: string;
    tienda: string;
    cliente: string;
    cancelo_en_dropi: boolean;
  },
  chatId: string,
  who: { visitorId: string; leadId: string | null },
): Promise<CancelRequestResult> {
  if (!input.cancelo_en_dropi) return { resultado: "primero_dropi" };
  const v = await verifyGuideOwner(input, chatId, who);
  if (!v.ok) return v.result;
  const row = v.row;
  const existing = await prisma.cancelledGuideReport.findFirst({
    where: { guideNumber: { equals: row.guideNumber, mode: "insensitive" } },
    orderBy: { createdAt: "desc" },
    select: { michelleStatus: true, retainedAt: true },
  });
  if (existing)
    return {
      resultado: "ya_pedida",
      estado:
        existing.michelleStatus ??
        (existing.retainedAt ? "RETENIDA" : "REPORTADA_POR_EL_EQUIPO"),
    };

  const timing = cancelTiming(row);
  if (timing.kind === "ya_salio") {
    const t = trackingFor(row.carrier);
    return {
      resultado: "ya_salio",
      transportadora: t.name,
      enlace_rastreo: t.url,
    };
  }

  const submittedById = await getInventoryLeadId();
  if (!submittedById)
    return { resultado: "fuera_de_horario", motivo: "hora_limite" };
  // Productos de la etiqueta: así el reingreso al Kardex no espera a nadie.
  const lookup = await lookupGuide(row.guideNumber, {
    productsOnly: true,
  }).catch(() => null);
  const lines = lookup?.ok ? lookup.source.lines : [];
  const outOfHours = timing.kind === "fuera_de_horario";
  const now = new Date();
  const n = await nextCancelledGuideNumber();
  await prisma.cancelledGuideReport.create({
    data: {
      code: formatCancelledGuideCode(n),
      reportNumber: n,
      submittedById,
      sourceArea: await sourceAreaOf(
        row,
        lines.map((l) => l.catalogItemId),
      ),
      guideNumber: row.guideNumber,
      carrier: CARRIER_ENUM(row.carrier),
      reason: MICHELLE_CANCEL_REASON,
      // El dropshipper ya la canceló en Dropi: no hace falta que Bryan la gestione.
      batchManagedAt: now,
      ...(lines.length
        ? {
            itemsAssignedAt: now,
            items: {
              create: lines.map((l) => ({
                catalogItemId: l.catalogItemId,
                declaredName: l.name,
                quantity: l.quantity,
              })),
            },
          }
        : {}),
      michelleChatId: chatId,
      michelleStatus: outOfHours ? "POR_APROBAR" : "POR_RETENER",
      michelleOutOfHours: outOfHours,
      michelleNote: outOfHours
        ? timing.motivo === "fin_de_semana"
          ? "Pedida en fin de semana o feriado"
          : "Pedida después de la hora límite"
        : null,
    },
  });

  const carrierName = trackingFor(row.carrier).name;
  if (outOfHours) {
    const lead = await getInventoryLeadId();
    if (lead)
      await notifyOwner(lead, {
        title: TITLE_APPROVE,
        body: `Guía ${row.guideNumber} · ${carrierName}. El dropshipper la canceló fuera de horario: decide si se busca.`,
        url: MICHELLE_CANCEL_URL,
      }).catch(() => null);
    return { resultado: "fuera_de_horario", motivo: timing.motivo };
  }
  await notifyHandlers(row.guideNumber, carrierName);
  return { resultado: "en_gestion" };
}

async function notifyHandlers(guideNumber: string, carrierName: string) {
  const ids = await idsByUsername(HANDLER_USERNAMES);
  await Promise.all(
    ids.map((id) =>
      notifyOwner(id, {
        title: TITLE_RETAIN,
        body: `Guía ${guideNumber} · ${carrierName}. El dropshipper la canceló: retenla físicamente y toma la foto.`,
        url: MICHELLE_CANCEL_URL,
      }).catch(() => null),
    ),
  );
}

// ---- Lista para Joao / Daniel / Allan ---------------------------------------

export async function listMichelleCancellations() {
  const since = new Date(Date.now() - 15 * 86_400_000);
  const rows = await prisma.cancelledGuideReport.findMany({
    where: {
      michelleStatus: { not: null },
      OR: [
        { michelleStatus: { in: ["POR_APROBAR", "POR_RETENER"] } },
        { createdAt: { gte: since } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      code: true,
      guideNumber: true,
      carrier: true,
      createdAt: true,
      michelleStatus: true,
      michelleOutOfHours: true,
      michelleNote: true,
      michelleDecidedAt: true,
      michelleDecidedById: true,
      retainedAt: true,
      retainedPhotoUrl: true,
      retainedBy: { select: { name: true } },
      items: { select: { declaredName: true, quantity: true } },
    },
  });
  const deciderIds = [
    ...new Set(
      rows.map((r) => r.michelleDecidedById).filter((x): x is string => !!x),
    ),
  ];
  const deciders = deciderIds.length
    ? await prisma.user.findMany({
        where: { id: { in: deciderIds } },
        select: { id: true, name: true },
      })
    : [];
  return rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    michelleDecidedAt: r.michelleDecidedAt?.toISOString() ?? null,
    retainedAt: r.retainedAt?.toISOString() ?? null,
    retainedByName: r.retainedBy?.name ?? null,
    decidedByName:
      deciders.find((d) => d.id === r.michelleDecidedById)?.name ?? null,
  }));
}

// ---- Acciones ---------------------------------------------------------------

export async function decideOutOfHours(
  id: string,
  accept: boolean,
  userId: string | null,
): Promise<string | null> {
  const now = new Date();
  const updated = await prisma.cancelledGuideReport.updateMany({
    where: { id, michelleStatus: "POR_APROBAR" },
    data: accept
      ? {
          michelleStatus: "POR_RETENER",
          michelleDecidedAt: now,
          michelleDecidedById: userId,
        }
      : {
          michelleStatus: "RECHAZADA",
          michelleDecidedAt: now,
          michelleDecidedById: userId,
          reallyCancelled: false,
        },
  });
  if (updated.count === 0) return "Esta cancelación ya fue decidida.";
  const r = await prisma.cancelledGuideReport.findUnique({
    where: { id },
    select: { guideNumber: true, carrier: true, michelleChatId: true },
  });
  if (!r) return null;
  const lead = await getInventoryLeadId();
  if (lead)
    await resolveNotifications(
      lead,
      TITLE_APPROVE,
      `Guía ${r.guideNumber} ·`,
    ).catch(() => null);
  if (accept) await notifyHandlers(r.guideNumber, trackingFor(r.carrier).name);
  else
    await tellDropshipper(
      r.michelleChatId,
      `Te cuento sobre tu guía **${r.guideNumber}** 🙏 El equipo la revisó, pero ya estaba en proceso de despacho y no se pudo cancelar. Puedes darle seguimiento con la transportadora, y si necesitas ayuda con tu cliente aquí estoy 💛`,
    );
  return null;
}

export async function markRetained(
  id: string,
  photoUrl: string,
  userId: string | null,
): Promise<string | null> {
  const now = new Date();
  const updated = await prisma.cancelledGuideReport.updateMany({
    where: { id, michelleStatus: "POR_RETENER" },
    data: {
      michelleStatus: "RETENIDA",
      retainedAt: now,
      retainedById: userId,
      retainedPhotoUrl: photoUrl,
      fulfillmentRemovedAt: now,
      fulfillmentRemovedById: userId,
    },
  });
  if (updated.count === 0) return "Esta guía ya no está pendiente de retener.";
  const r = await prisma.cancelledGuideReport.findUnique({
    where: { id },
    select: {
      guideNumber: true,
      michelleChatId: true,
      retainedBy: { select: { name: true } },
    },
  });
  if (!r) return null;
  const who = r.retainedBy?.name ?? "el equipo";
  // Vuelve sola al Kardex (ya tiene productos cargados y "gestionada").
  await autoReingresoReadyCancelledGuides([id]).catch((e) =>
    console.error("[michelle retain reingreso]", e),
  );
  // Deja de sumar en Pedidos despachados.
  const inCut = await prisma.fulfillmentRequestGuide.findMany({
    where: { guideNumber: { equals: r.guideNumber, mode: "insensitive" } },
    select: { batch: { select: { lot: { select: { day: true } } } } },
  });
  for (const day of new Set(
    inCut.map((g) => g.batch.lot?.day).filter((d): d is string => !!d),
  ))
    await recomputeAutoFillRate(day).catch(() => null);

  const handlers = await idsByUsername(HANDLER_USERNAMES);
  await Promise.all(
    handlers.map((h) =>
      resolveNotifications(h, TITLE_RETAIN, `Guía ${r.guideNumber} ·`).catch(
        () => null,
      ),
    ),
  );
  const watchers = (await watcherIds()).filter((w) => w !== userId);
  await Promise.all(
    watchers.map((w) =>
      notifyOwner(w, {
        title: "✅ Guía retenida",
        body: `La guía ${r.guideNumber} ha sido retenida por ${who} (cancelada por el dropshipper, con foto).`,
        url: MICHELLE_CANCEL_URL,
      }).catch(() => null),
    ),
  );
  await tellDropshipper(
    r.michelleChatId,
    `¡Buenas noticias! ✅ Tu guía **${r.guideNumber}** fue retenida y **no saldrá**. Aquí tienes la foto de evidencia 📸\n[[FOTO:${id}]]`,
  );
  return null;
}

export async function markNotRetained(
  id: string,
  reason: "ya_salio" | "no_encontrada",
  userId: string | null,
): Promise<string | null> {
  const note =
    reason === "ya_salio"
      ? "Ya había salido con la transportadora"
      : "No se encontró en bodega";
  const updated = await prisma.cancelledGuideReport.updateMany({
    where: { id, michelleStatus: "POR_RETENER" },
    data: {
      michelleStatus: "NO_RETENIDA",
      michelleNote: note,
      michelleDecidedAt: new Date(),
      michelleDecidedById: userId,
      reallyCancelled: false,
    },
  });
  if (updated.count === 0) return "Esta guía ya no está pendiente de retener.";
  const r = await prisma.cancelledGuideReport.findUnique({
    where: { id },
    select: { guideNumber: true, michelleChatId: true },
  });
  if (!r) return null;
  const handlers = await idsByUsername(HANDLER_USERNAMES);
  await Promise.all(
    handlers.map((h) =>
      resolveNotifications(h, TITLE_RETAIN, `Guía ${r.guideNumber} ·`).catch(
        () => null,
      ),
    ),
  );
  const watchers = (await watcherIds()).filter((w) => w !== userId);
  await Promise.all(
    watchers.map((w) =>
      notifyOwner(w, {
        title: "Guía cancelada no retenida",
        body: `Guía ${r.guideNumber}: ${note}.`,
        url: MICHELLE_CANCEL_URL,
      }).catch(() => null),
    ),
  );
  await tellDropshipper(
    r.michelleChatId,
    reason === "ya_salio"
      ? `Te cuento sobre tu guía **${r.guideNumber}** 🙏 El equipo la buscó, pero ya había salido con la transportadora, así que no se pudo retener. Puedes darle seguimiento con su número de guía en la página de la transportadora 💛`
      : `Te cuento sobre tu guía **${r.guideNumber}** 🙏 El equipo la buscó pero no la encontró en bodega, lo más probable es que ya haya salido. Puedes darle seguimiento con la transportadora 💛`,
  );
  return null;
}

// ---- Inicio -----------------------------------------------------------------

// Joao: guías por retener. Daniel (líder INV): las de fuera de horario por decidir.
export async function getMichelleCancelPendingItems(
  userId: string,
): Promise<PendingItem[]> {
  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      username: true,
      isLeader: true,
      leadsDept: { select: { code: true } },
    },
  });
  if (!me) return [];
  const out: PendingItem[] = [];
  if (HANDLER_USERNAMES.includes(me.username ?? "")) {
    const rows = await prisma.cancelledGuideReport.findMany({
      where: { michelleStatus: "POR_RETENER" },
      select: { createdAt: true },
    });
    if (rows.length)
      out.push({
        type: "michelle_por_retener",
        icon: "🔴",
        label: "Guías canceladas por retener (chat de provedix)",
        meta: `${rows.length} guía${rows.length === 1 ? "" : "s"} · búscala, retenla y toma la foto`,
        overdue: rows.some(
          (r) => Date.now() - r.createdAt.getTime() > 30 * 60_000,
        ),
        href: MICHELLE_CANCEL_URL,
      });
  }
  if (me.isLeader && me.leadsDept?.code === "INV") {
    const n = await prisma.cancelledGuideReport.count({
      where: { michelleStatus: "POR_APROBAR" },
    });
    if (n)
      out.push({
        type: "michelle_por_aprobar",
        icon: "⏰",
        label: "Cancelaciones fuera de horario por decidir",
        meta: `${n} guía${n === 1 ? "" : "s"} · ¿se busca o no se puede?`,
        overdue: true,
        href: MICHELLE_CANCEL_URL,
      });
  }
  return out;
}
