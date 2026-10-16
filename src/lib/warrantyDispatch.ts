import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canActOnMerchandiseOutflow } from "@/lib/guards";
import { notifyOwner, resolveNotifications } from "@/lib/notifications";
import type { PendingItem } from "@/lib/pendingTasks";

// Garantías por despachar (pedido de Daniel 2026-10-14, ajustado por el
// usuario): Michelle y Yair anotan el número de guía de una garantía ya
// autorizada con un comentario opcional — el archivo ya no lo suben ellos
// (pedido de Daniel 2026-10-15): llega en el corte que suben Allan o Daniel
// y se cruza solo por el número (ver cutFile en la lista); Joao la toma (visto) y saca la guía físicamente;
// Daniel o Allan revisan que esté correcto. No mueve stock — eso sigue
// saliendo del corte. Para sumar a alguien, ampliar estas listas.
const UPLOADER_USERNAMES = new Set(["mramirez", "yairurgilez"]);
const HANDLER_USERNAMES = new Set(["joao2026"]);
const VERIFIER_USERNAMES = new Set(["allan2026"]); // + Daniel (líder INV)

export const WARRANTY_DISPATCH_URL = "/area/workspace?tab=egresos&otab=garantias";
const TITLE_NEW = "Garantía para despachar";
const TITLE_REVIEW = "Garantía por revisar";

export type WarrantyDispatchRole = {
  userId: string;
  canUpload: boolean;
  canHandle: boolean;
  canVerify: boolean;
  isAdmin: boolean;
};

export async function getWarrantyDispatchRole(): Promise<WarrantyDispatchRole | null> {
  const session = await auth();
  if (!session) return null;
  const isAdmin = session.user.role === "admin";
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { username: true, isActive: true } });
  const active = !!user?.isActive;
  const name = user?.username ?? "";
  const role: WarrantyDispatchRole = {
    userId: session.user.id,
    canUpload: active && UPLOADER_USERNAMES.has(name),
    canHandle: active && HANDLER_USERNAMES.has(name),
    canVerify: active && (VERIFIER_USERNAMES.has(name) || (await canActOnMerchandiseOutflow())),
    isAdmin,
  };
  if (!role.canUpload && !role.canHandle && !role.canVerify && !isAdmin) return null;
  return role;
}

async function idsFor(usernames: Set<string>): Promise<string[]> {
  const rows = await prisma.user.findMany({ where: { username: { in: [...usernames] }, isActive: true }, select: { id: true } });
  return rows.map((r) => r.id);
}

async function verifierIds(): Promise<string[]> {
  const [extra, leaders] = await Promise.all([
    idsFor(VERIFIER_USERNAMES),
    prisma.user.findMany({ where: { isActive: true, isLeader: true, leadsDept: { code: "INV" } }, select: { id: true } }),
  ]);
  return [...new Set([...extra, ...leaders.map((l) => l.id)])];
}

export async function notifyHandlersNewGuide(guideNumber: string, uploaderName: string) {
  const ids = await idsFor(HANDLER_USERNAMES);
  await Promise.all(
    ids.map((id) =>
      notifyOwner(id, {
        title: TITLE_NEW,
        body: `Guía ${guideNumber} · subida por ${uploaderName}. Sácala y márcala con el visto.`,
        url: WARRANTY_DISPATCH_URL,
      }).catch(() => null),
    ),
  );
}

export async function resolveNewGuideNotice(guideNumber: string) {
  const ids = await idsFor(HANDLER_USERNAMES);
  await Promise.all(ids.map((id) => resolveNotifications(id, TITLE_NEW, `Guía ${guideNumber} ·`).catch(() => null)));
}

export async function notifyVerifiers(guideNumber: string, handlerName: string) {
  const ids = await verifierIds();
  await Promise.all(
    ids.map((id) =>
      notifyOwner(id, {
        title: TITLE_REVIEW,
        body: `Guía ${guideNumber} · ${handlerName} la está gestionando. Revisa que sea correcto.`,
        url: WARRANTY_DISPATCH_URL,
      }).catch(() => null),
    ),
  );
}

export async function resolveVerifierNotice(guideNumber: string) {
  const ids = await verifierIds();
  await Promise.all(ids.map((id) => resolveNotifications(id, TITLE_REVIEW, `Guía ${guideNumber} ·`).catch(() => null)));
}

// Pendientes + lo revisado en los últimos 30 días, con nombres.
export async function listWarrantyDispatchGuides() {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const rows = await prisma.warrantyDispatchGuide.findMany({
    where: { OR: [{ verifiedAt: null }, { verifiedAt: { gte: since } }] },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const userIds = [...new Set(rows.flatMap((r) => [r.uploadedById, r.handledById, r.verifiedById]).filter((x): x is string => !!x))];
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
  const nameOf = (id: string | null) => (id ? users.find((u) => u.id === id)?.name ?? "—" : null);
  // Cruce con el corte: la misma guía subida por Allan o Daniel en
  // Registro de Egresos → Solicitud. Abre el PDF del manifiesto donde vino.
  const cutGuides = await prisma.fulfillmentRequestGuide.findMany({
    where: { guideNumber: { in: [...new Set(rows.map((r) => r.guideNumber))], mode: "insensitive" } },
    select: { guideNumber: true, manifestFile: true, manifestDay: true, createdAt: true, batch: { select: { fileUrls: true, requestedBy: { select: { name: true } } } } },
  });
  const cutOf = (guideNumber: string) => {
    const g = cutGuides.find((c) => c.guideNumber.toUpperCase() === guideNumber.toUpperCase());
    if (!g) return null;
    const urls = g.batch.fileUrls;
    const url = g.manifestFile !== null ? urls[g.manifestFile] : urls.length === 1 ? urls[0] : undefined;
    return { url: url ?? null, day: g.manifestDay, uploadedAt: g.createdAt.toISOString(), uploadedByName: g.batch.requestedBy?.name ?? null };
  };
  return rows.map((r) => ({
    id: r.id,
    guideNumber: r.guideNumber,
    // Guías anotadas antes del cambio traen su propio archivo; las nuevas, "".
    fileUrl: r.fileUrl || null,
    fileName: r.fileName,
    cutFile: cutOf(r.guideNumber),
    comment: r.comment,
    createdAt: r.createdAt.toISOString(),
    uploadedById: r.uploadedById,
    uploadedByName: nameOf(r.uploadedById),
    handledAt: r.handledAt?.toISOString() ?? null,
    handledByName: nameOf(r.handledById),
    verifiedAt: r.verifiedAt?.toISOString() ?? null,
    verifiedByName: nameOf(r.verifiedById),
  }));
}

export async function userName(id: string): Promise<string> {
  const u = await prisma.user.findUnique({ where: { id }, select: { name: true } });
  return u?.name ?? "—";
}

// Pendientes en Inicio (pedido de Daniel 2026-10-16): apenas Michelle o Yair
// anotan una garantía, Daniel y Allan la ven en "Pendientes" (no solo cuando
// Joao la marca) — así saben que tienen que subir su corte. Joao ve las que
// están sin tomar. Desaparecen solas al avanzar.
export async function getWarrantyDispatchPendingItems(userId: string): Promise<PendingItem[]> {
  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { username: true, isActive: true, isLeader: true, leadsDept: { select: { code: true } } },
  });
  if (!me?.isActive) return [];
  const name = me.username ?? "";
  const isHandler = HANDLER_USERNAMES.has(name);
  const isVerifier = VERIFIER_USERNAMES.has(name) || (me.isLeader && me.leadsDept?.code === "INV");
  if (!isHandler && !isVerifier) return [];

  const open = await prisma.warrantyDispatchGuide.findMany({
    where: { verifiedAt: null },
    select: { guideNumber: true, createdAt: true, handledAt: true },
    orderBy: { createdAt: "asc" },
  });
  if (open.length === 0) return [];
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const metaOf = (rows: { guideNumber: string }[], tail: string) =>
    `${rows.length === 1 ? `Guía ${rows[0].guideNumber}` : `${rows.length} garantías`} · ${tail}`;
  const untaken = open.filter((g) => !g.handledAt);
  const out: PendingItem[] = [];

  if (isHandler && untaken.length) {
    out.push({
      type: "garantias_despachar_tomar",
      icon: "🛡️",
      label: "Garantías por despachar — sácalas y márcalas con el visto",
      meta: metaOf(untaken, "sin tomar"),
      overdue: untaken.some((g) => g.createdAt.getTime() < dayAgo),
      href: WARRANTY_DISPATCH_URL,
    });
  }

  if (isVerifier) {
    if (untaken.length) {
      const cut = await prisma.fulfillmentRequestGuide.findMany({
        where: { guideNumber: { in: untaken.map((g) => g.guideNumber), mode: "insensitive" } },
        select: { guideNumber: true },
      });
      const hasCut = new Set(cut.map((c) => c.guideNumber.toUpperCase()));
      const waitingCut = untaken.filter((g) => !hasCut.has(g.guideNumber.toUpperCase()));
      if (waitingCut.length)
        out.push({
          type: "garantias_despachar_corte",
          icon: "🛡️",
          label: "Garantías anotadas — falta subir su corte en Solicitud",
          meta: metaOf(waitingCut, "revisa la lista de Garantías"),
          overdue: waitingCut.some((g) => g.createdAt.getTime() < dayAgo),
          href: WARRANTY_DISPATCH_URL,
        });
    }
    const toReview = open.filter((g) => g.handledAt);
    if (toReview.length)
      out.push({
        type: "garantias_despachar_revisar",
        icon: "🛡️",
        label: "Garantías por revisar — Joao ya las tomó",
        meta: metaOf(toReview, "pulsa Correcto"),
        overdue: toReview.some((g) => g.handledAt!.getTime() < dayAgo),
        href: WARRANTY_DISPATCH_URL,
      });
  }
  return out;
}
