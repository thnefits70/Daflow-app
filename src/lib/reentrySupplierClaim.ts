import { prisma } from "@/lib/prisma";
import { notifyOwner } from "@/lib/notifications";
import { getFinanceLeadId, getInventoryLeadId } from "@/lib/guards";
import { itemDisplayName, maybeMarkBatchClosed } from "@/lib/merchandiseReentry";
import { formatMerchandiseOutflowCode, nextMerchandiseOutflowNumber, notifyMarketingLeadOutflowEscalated } from "@/lib/merchandiseOutflow";
import { recordKardexEntry } from "@/lib/stockKardex";

// Confirmado 2026-09-24, pedido de Nairoby: una devolución de cliente que
// llegó dañada no siempre se da de baja — a veces Daniel la devuelve al
// proveedor para que mande una en buen estado (o dé saldo a favor). Antes
// el sistema solo tenía "No solucionado" = baja, y el caso le aparecía a
// Nairoby como baja aunque en realidad era una reposición. Ahora Daniel lo
// pasa a reclamo con proveedor: sale de la lista semanal de bajas y sigue
// el mismo camino que un deterioro escalado (Jariel gestiona, Daniel arma el
// paquete, y el caso se cierra recién cuando llega el reemplazo).

const LINK_WINDOW_DAYS = 45;

// Reportes de deterioro ya escalados del mismo producto que todavía no
// están enlazados a ninguna devolución — el caso real del 24-sep: Daniel ya
// había reportado los 3 Exprimidores de RM-0027 como deterioro (EG-0075) y
// eso restó el stock otra vez.
export async function findReentryClaimLinkCandidates(reentryItem: { catalogItemId: string | null; damagedQty: number }) {
  if (!reentryItem.catalogItemId) return [];
  const since = new Date(Date.now() - LINK_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const rows = await prisma.merchandiseOutflowItem.findMany({
    where: {
      catalogItemId: reentryItem.catalogItemId,
      sourceReentryItemId: null,
      // Ya empacado para devolver = caso de bodega en marcha, no esta devolución.
      exchangeItem: null,
      resolution: "ESCALATED_TO_PURCHASES",
      quantity: { gte: reentryItem.damagedQty },
      batch: { reason: "DETERIORO", submittedAt: { gte: since } },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      quantity: true,
      purchaseResolution: true,
      batch: { select: { code: true, submittedAt: true, createdBy: { select: { name: true } } } },
      stockKardexEntry: { select: { type: true, quantity: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    code: r.batch.code,
    quantity: r.quantity,
    reportedAt: r.batch.submittedAt,
    reportedByName: r.batch.createdBy?.name ?? "—",
    purchaseResolution: r.purchaseResolution,
    stockWasSubtracted: r.stockKardexEntry?.type === "OUT",
  }));
}

export class ReentryClaimError extends Error {
  constructor(message: string, public status = 409) {
    super(message);
  }
}

export async function claimReentryDamageToSupplier(params: { reentryItemId: string; actorId: string; actorName: string; linkOutflowItemId?: string | null; note?: string | null }) {
  const item = await prisma.merchandiseReentryItem.findUnique({
    where: { id: params.reentryItemId },
    include: { batch: { select: { code: true } }, catalogItem: { select: { name: true } }, supplierClaim: { select: { id: true } } },
  });
  if (!item) throw new ReentryClaimError("No encontrado.", 404);
  if (item.damagedQty <= 0 || item.damageConfirmed !== true) throw new ReentryClaimError("Este producto no tiene daño confirmado.");
  if (item.damageSolved === true) throw new ReentryClaimError("Este producto ya se marcó como solucionado.");
  if (item.supplierClaimAt || item.supplierClaim) throw new ReentryClaimError("Este producto ya se pasó a reclamo con el proveedor.");
  if (item.disposalDecision !== null || item.writeOffAt) throw new ReentryClaimError("Nairoby ya decidió qué hacer con este producto (destruir o percha), ya no se puede cambiar.");

  const name = itemDisplayName(item);
  const now = new Date();
  const note = params.note?.trim() || null;
  let claimCode: string;
  let restoredQty = 0;

  if (params.linkOutflowItemId) {
    const candidates = await findReentryClaimLinkCandidates(item);
    const target = candidates.find((c) => c.id === params.linkOutflowItemId);
    if (!target) throw new ReentryClaimError("Ese reporte de deterioro no corresponde a este producto o ya está unido a otra devolución.");

    await prisma.$transaction(async (tx) => {
      const claimed = await tx.merchandiseReentryItem.updateMany({
        where: { id: item.id, supplierClaimAt: null, disposalDecision: null },
        data: { supplierClaimAt: now, supplierClaimById: params.actorId, weeklyWriteOffBatchId: null, damageSolved: false, damageSolvedAt: item.damageSolvedAt ?? now, damageSolvedById: item.damageSolvedById ?? params.actorId },
      });
      if (claimed.count === 0) throw new ReentryClaimError("Este producto ya cambió, recarga la pantalla.");
      const linked = await tx.merchandiseOutflowItem.updateMany({ where: { id: target.id, sourceReentryItemId: null }, data: { sourceReentryItemId: item.id } });
      if (linked.count === 0) throw new ReentryClaimError("Ese reporte de deterioro ya se unió a otra devolución.");
    });
    claimCode = target.code;

    // Esas unidades dañadas nunca volvieron a sumar en INVESTOCK (de una
    // devolución solo entra lo bueno), así que el reporte de deterioro las
    // restó por segunda vez — se devuelven acá.
    if (target.stockWasSubtracted && item.catalogItemId) {
      restoredQty = item.damagedQty;
      await recordKardexEntry({ catalogItemId: item.catalogItemId, type: "IN", quantity: restoredQty, unitCost: null, occurredAt: now }).catch((err) => {
        restoredQty = 0;
        console.error("[claimReentryDamageToSupplier] No se pudo devolver el stock restado dos veces:", err);
      });
    }
  } else {
    const batchNumber = await nextMerchandiseOutflowNumber();
    const code = formatMerchandiseOutflowCode(batchNumber);
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.merchandiseReentryItem.updateMany({
        where: { id: item.id, supplierClaimAt: null, disposalDecision: null },
        data: { supplierClaimAt: now, supplierClaimById: params.actorId, weeklyWriteOffBatchId: null, damageSolved: false, damageSolvedAt: item.damageSolvedAt ?? now, damageSolvedById: item.damageSolvedById ?? params.actorId },
      });
      if (claimed.count === 0) throw new ReentryClaimError("Este producto ya cambió, recarga la pantalla.");
      // Nace ya enviado y escalado a Compras: la revisión física y la
      // decisión de Daniel ya ocurrieron en Reingreso. SIN salida de Kardex.
      await tx.merchandiseOutflowBatch.create({
        data: {
          code,
          batchNumber,
          reason: "DETERIORO",
          createdById: params.actorId,
          submittedAt: now,
          documentPhotoUrls: item.photoUrls.slice(0, 1),
          items: {
            create: [
              {
                catalogItemId: item.catalogItemId,
                declaredName: name,
                quantity: item.damagedQty,
                photoUrls: item.photoUrls,
                damageReasonId: item.damageReasonId,
                damageReasonOther: item.damageReasonOther,
                resolution: "ESCALATED_TO_PURCHASES",
                resolutionNote: note ?? `Devolución de cliente ${item.batch.code} dañada — se reclama al proveedor (cambio o saldo a favor).`,
                resolvedAt: now,
                resolvedById: params.actorId,
                sourceReentryItemId: item.id,
              },
            ],
          },
        },
      });
    });
    claimCode = code;
    await notifyMarketingLeadOutflowEscalated({ declaredName: `${name} (devolución de cliente ${item.batch.code})`, quantity: item.damagedQty }).catch(() => null);
  }

  await maybeMarkBatchClosed(item.batchId);

  const financeLeadId = await getFinanceLeadId();
  if (financeLeadId) {
    await notifyOwner(financeLeadId, {
      title: "Devolución dañada: no es baja, es reclamo al proveedor",
      body: `${params.actorName} sacó ${name} (${item.damagedQty} un., ${item.batch.code}) de la lista de bajas — se reclama al proveedor en ${claimCode}.${restoredQty > 0 ? ` Se devolvieron ${restoredQty} un. al stock que se habían restado dos veces.` : ""}`,
      url: "/area/workspace?tab=egresos&otab=seguimiento",
    }).catch(() => null);
  }

  return { claimCode, restoredQty };
}

// Confirmado 2026-09-24, pedido de Nairoby: "que me notifique cuando un
// proceso no se cumpla o se pase por alto". Detecta los reclamos al
// proveedor que se quedaron trabados en algún paso. Lo usan los Pendientes
// de Inicio (y por lo tanto el aviso diario de las 8:00).
export const CLAIM_GAP_DAYS = { gestion: 7, package: 5, arrival: 10 } as const;

export async function getSupplierClaimGaps() {
  const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

  const [noGestion, noSupplierAnswer, noPackage, notArrived, doubles] = await Promise.all([
    // Deterioro escalado que Jariel todavía no gestiona.
    prisma.merchandiseOutflowItem.count({
      where: { resolution: "ESCALATED_TO_PURCHASES", purchaseResolution: null, OR: [{ purchaseNoMatchReportedAt: null }, { purchaseExceptionDecision: { not: null } }], batch: { reason: "DETERIORO", submittedAt: { lt: daysAgo(CLAIM_GAP_DAYS.gestion) } } },
    }),
    // Paquete enviado al proveedor que nadie respondió todavía.
    prisma.merchandiseOutflowItem.count({
      where: { resolution: null, batch: { reason: "CAMBIO_PROVEEDOR", submittedAt: { lt: daysAgo(CLAIM_GAP_DAYS.gestion) } } },
    }),
    // El proveedor ya aceptó (cambio o crédito) y el paquete no sale.
    prisma.merchandiseOutflowItem.count({
      where: {
        resolution: "ESCALATED_TO_PURCHASES",
        purchaseResolution: { in: ["REPLACED", "CREDIT_ISSUED"] },
        purchaseResolvedAt: { lt: daysAgo(CLAIM_GAP_DAYS.package) },
        OR: [{ exchangeItem: null }, { exchangeItem: { batch: { submittedAt: null } } }],
      },
    }),
    // Cambio aceptado y paquete enviado, pero el reemplazo no llega.
    prisma.merchandiseOutflowItem.count({
      where: {
        resolution: "REPLACED",
        replacementReceivedAt: null,
        resolvedAt: { lt: daysAgo(CLAIM_GAP_DAYS.arrival) },
        batch: { reason: "CAMBIO_PROVEEDOR", submittedAt: { lt: daysAgo(CLAIM_GAP_DAYS.arrival) } },
      },
    }),
    findPossibleDoubleRegistrations(),
  ]);

  return { noGestion: noGestion + noSupplierAnswer, noPackage, notArrived, doubles };
}

// Mismo producto en la lista de devoluciones dañadas (todavía sin decidir)
// y en un reporte de deterioro escalado sin enlazar, con pocos días de
// diferencia — casi seguro es la misma mercadería registrada dos veces.
export async function findPossibleDoubleRegistrations() {
  const since = new Date(Date.now() - LINK_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const reentry = await prisma.merchandiseReentryItem.findMany({
    where: { damagedQty: { gt: 0 }, damageConfirmed: true, damageSolved: false, supplierClaimAt: null, disposalDecision: null, catalogItemId: { not: null }, createdAt: { gte: since } },
    select: { id: true, catalogItemId: true, damagedQty: true, correctedName: true, declaredName: true, catalogItem: { select: { name: true } }, batch: { select: { code: true } } },
  });
  if (reentry.length === 0) return [];
  const deterioros = await prisma.merchandiseOutflowItem.findMany({
    where: { catalogItemId: { in: reentry.map((r) => r.catalogItemId!) }, sourceReentryItemId: null, exchangeItem: null, resolution: "ESCALATED_TO_PURCHASES", batch: { reason: "DETERIORO", submittedAt: { gte: since } } },
    select: { catalogItemId: true, quantity: true, batch: { select: { code: true } } },
    orderBy: { createdAt: "desc" },
  });
  const pairs: { name: string; reentryCode: string; deteriorCode: string }[] = [];
  for (const r of reentry) {
    const d = deterioros.find((x) => x.catalogItemId === r.catalogItemId && x.quantity >= r.damagedQty);
    if (d) pairs.push({ name: itemDisplayName(r), reentryCode: r.batch.code, deteriorCode: d.batch.code });
  }
  return pairs;
}

// Aviso inmediato al enviar un reporte de deterioro que choca con una
// devolución dañada del mismo producto (ver batches/[id]/submit).
export async function notifyPossibleDoubleRegistration(catalogItemIds: string[]) {
  if (catalogItemIds.length === 0) return;
  const pairs = await findPossibleDoubleRegistrations();
  if (pairs.length === 0) return;
  const ids = new Set(catalogItemIds);
  const relevant = await prisma.merchandiseReentryItem.findMany({
    where: { catalogItemId: { in: [...ids] }, damagedQty: { gt: 0 }, damageConfirmed: true, damageSolved: false, supplierClaimAt: null, disposalDecision: null },
    select: { batch: { select: { code: true } } },
  });
  const codes = new Set(relevant.map((r) => r.batch.code));
  const hits = pairs.filter((p) => codes.has(p.reentryCode));
  if (hits.length === 0) return;
  const body = `${hits.map((p) => `${p.name} (${p.reentryCode} y ${p.deteriorCode})`).join("; ")} — si es la misma mercadería, Daniel debe usar "No es baja: se reclamó al proveedor" en Control de Daños y unirlo, para no restar el stock dos veces.`;
  const [financeLeadId, inventoryLeadId] = await Promise.all([getFinanceLeadId(), getInventoryLeadId()]);
  for (const id of new Set([financeLeadId, inventoryLeadId].filter(Boolean) as string[])) {
    await notifyOwner(id, { title: "⚠️ Posible doble registro de un producto dañado", body, url: "/area/reingreso-mercaderia?tab=danos" }).catch(() => null);
  }
}
