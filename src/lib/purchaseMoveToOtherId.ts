import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { notifyOwner } from "@/lib/notifications";
import { formatPurchaseRequestCode } from "@/lib/purchases";
import { getPurchaseApproverIds } from "@/lib/guards";
import { formatMarketProductProposalCode, nextMarketProductProposalNumber } from "@/lib/marketProduct";
import { computeMarketProductSalePrice } from "@/lib/dropiPricing";
import { notifyPublishersOfApproval } from "@/lib/publishNotices";

// Pedido de Bryan Ríos 2026-10-15 (caso SC-181, chalecos de CHEN): un modelo
// distinto comprado como recompra entraba al mismo ID y en bodega quedaban
// mezclados los dos — Daniel no podía aprobar la recepción sin crearse un
// lío en su inventario. Dos piezas:
// 1. Al solicitar, quien pide confirma (viendo la foto) que lo que compra es
//    IGUAL al producto que ya tenemos. Si no lo es, no lo pide como recompra:
//    crea el producto nuevo con su propio ID.
// 2. Si igual se escapa, Bryan (al aprobar o después) o Daniel (al aprobar la
//    recepción) pasan la compra a otro ID antes de que entre al Kardex: a un
//    producto que ya existe (escriben su ID) o a un MODELO NUEVO (solo el
//    nombre). El modelo nuevo sigue el camino de cualquier producto nuevo de
//    Análisis de Mercado (opción B que eligió el usuario el 2026-10-15): se
//    crea su propuesta ya aprobada, la asesora B2B lo publica en Dropi y pone
//    el ID, y Bryan lo libera al Kardex. Mientras tanto la recepción se
//    aprueba igual y no suma a ningún stock (awaitingDropiId).

// Productos que ya tenemos: alguna compra anterior ya llegó o el Kardex tuvo
// movimiento real. Solo para esos se exige la confirmación.
export async function catalogItemsNeedingSameProductCheck(ids: string[]): Promise<{ id: string; name: string }[]> {
  if (ids.length === 0) return [];
  return prisma.purchaseCatalogItem.findMany({
    where: {
      id: { in: ids },
      OR: [
        { requests: { some: { status: { in: ["RECEIVED_PENDING_REVIEW", "RECEIVED"] } } } },
        { stockKardexEntries: { some: { NOT: { type: "SEED", quantity: 0 } } } },
      ],
    },
    select: { id: true, name: true },
  });
}

export async function checkSameProductConfirmed(items: { catalogItemId: string; sameProductConfirmed?: boolean | null }[]): Promise<string | null> {
  const unconfirmed = [...new Set(items.filter((it) => !it.sameProductConfirmed).map((it) => it.catalogItemId))];
  const known = await catalogItemsNeedingSameProductCheck(unconfirmed);
  if (known.length === 0) return null;
  return `Confirma que lo que vas a comprar es igual al producto que ya tenemos: ${known.map((k) => k.name).join(", ")}. Si es un modelo distinto, créalo como producto nuevo con su propio ID.`;
}

export const MOVABLE_STATUSES = ["PENDING_APPROVAL", "APPROVED", "PAID", "RECEIVED_PENDING_REVIEW"] as const;
type MovableStatus = (typeof MOVABLE_STATUSES)[number];

export type MoveTarget = { existingCatalogItemId: string } | { newItem: { name: string; photos: string[] } };

export async function findCatalogItemByJustCode(justCode: string) {
  return prisma.purchaseCatalogItem.findUnique({
    where: { justCode: justCode.trim() },
    select: { id: true, name: true, justCode: true, photos: true },
  });
}

type MoveSource = { id: string; status: MovableStatus; catalogItemId: string; catalogItem: { name: string; justCode: string | null } };

// Solo mueve si la compra sigue como se leyó (nadie la aprobó, recibió o
// movió en el medio).
async function movePurchase(db: Prisma.TransactionClient | typeof prisma, request: MoveSource, catalogItemId: string, marketProductProposalId: string | null, actorId: string): Promise<boolean> {
  const updated = await db.purchaseRequest.updateMany({
    where: { id: request.id, status: request.status, catalogItemId: request.catalogItemId },
    data: {
      catalogItemId,
      ...(marketProductProposalId ? { marketProductProposalId } : {}),
      movedFromItemName: request.catalogItem.name,
      movedFromJustCode: request.catalogItem.justCode,
      movedToOtherIdAt: new Date(),
      movedToOtherIdById: actorId,
      sameProductConfirmedAt: null,
    },
  });
  return updated.count > 0;
}

const CHANGED = "La compra cambió mientras tanto — recarga e intenta de nuevo.";

export async function moveRequestToOtherId(params: {
  requestId: string;
  target: MoveTarget;
  actorId: string;
}): Promise<{ ok: true; catalogItemId: string; name: string; justCode: string | null; proposalCode: string | null } | { ok: false; error: string; status: number }> {
  const request = await prisma.purchaseRequest.findUnique({
    where: { id: params.requestId },
    select: {
      id: true,
      status: true,
      requestNumber: true,
      requestedById: true,
      catalogItemId: true,
      supplierId: true,
      quantity: true,
      totalCost: true,
      shippingIncluded: true,
      shippingCostTotal: true,
      catalogItem: { select: { name: true, justCode: true, bodega: true } },
      receipt: { select: { stockKardexEntry: { select: { id: true } } } },
    },
  });
  if (!request) return { ok: false, error: "No encontrada.", status: 404 };
  if (!(MOVABLE_STATUSES as readonly string[]).includes(request.status) || request.receipt?.stockKardexEntry) {
    return { ok: false, error: "Esta compra ya entró al stock — ya no se puede pasar a otro ID.", status: 409 };
  }
  const source: MoveSource = { ...request, status: request.status as MovableStatus };

  let target: { id: string; name: string; justCode: string | null };
  let proposal: { id: string; code: string } | null = null;
  if ("existingCatalogItemId" in params.target) {
    const item = await prisma.purchaseCatalogItem.findUnique({
      where: { id: params.target.existingCatalogItemId },
      select: { id: true, name: true, justCode: true },
    });
    if (!item) return { ok: false, error: "No se encontró ese producto.", status: 404 };
    if (item.id === request.catalogItemId) return { ok: false, error: "La compra ya está en ese producto.", status: 409 };
    if (!(await movePurchase(prisma, source, item.id, null, params.actorId))) return { ok: false, error: CHANGED, status: 409 };
    target = item;
  } else {
    const { name, photos } = params.target.newItem;
    const nameTaken = await prisma.purchaseCatalogItem.findFirst({ where: { name: { equals: name, mode: "insensitive" } }, select: { name: true } });
    if (nameTaken) return { ok: false, error: `Ya existe "${nameTaken.name}" — ponle un nombre que diferencie el modelo nuevo.`, status: 409 };
    const proposalTaken = await prisma.marketProductProposal.findFirst({
      where: { productName: { equals: name, mode: "insensitive" }, status: { in: ["PENDING_APPROVAL", "APPROVED"] } },
      select: { code: true },
    });
    if (proposalTaken) return { ok: false, error: `Ya hay una propuesta con ese nombre (${proposalTaken.code}) — ponle otro nombre.`, status: 409 };

    const freightCost = request.shippingIncluded ? null : request.shippingCostTotal;
    const number = await nextMarketProductProposalNumber();
    const fromLabel = `${request.catalogItem.name}${request.catalogItem.justCode ? ` (${request.catalogItem.justCode})` : ""}`;
    const result = await prisma
      .$transaction(async (tx) => {
        // Misma marca que el producto del que viene; el área de bodega la
        // elige Daniel al aprobar la recepción (producto sin área).
        const item = await tx.purchaseCatalogItem.create({
          data: { name, photos, bodega: request.catalogItem.bodega, awaitingDropiId: true, createdById: params.actorId },
          select: { id: true, name: true, justCode: true },
        });
        // Precio con la misma fórmula que una propuesta normal, sobre lo que
        // costó esta compra (más su flete aparte, si lo tiene).
        const created = await tx.marketProductProposal.create({
          data: {
            code: formatMarketProductProposalCode(number),
            productName: name,
            referenceImageUrl: photos[0],
            description: `Otro modelo de ${fromLabel}${request.requestNumber ? ` — compra ${formatPurchaseRequestCode(request.requestNumber)}` : ""}. Creado al pasar la compra a su propio ID.`,
            platform: "DROPI",
            noCompetitorData: true,
            discoverySourceNote: "Modelo nuevo que llegó en una compra",
            calculatedSalePrice: computeMarketProductSalePrice({
              batchCost: request.totalCost,
              batchUnits: request.quantity,
              freightCost,
              insuranceRatePercent: 6,
              fulfillmentCost: 0.75,
              marginPercent: 20,
            }),
            status: "APPROVED",
            proposedById: params.actorId,
            reviewedById: params.actorId,
            reviewedAt: new Date(),
            bodega: request.catalogItem.bodega,
            catalogItemId: item.id,
            chosenSupplierId: request.supplierId,
            // Ya está comprado: nunca aparece en "listo para comprar".
            readyToBuyAt: new Date(),
            readyToBuyById: params.actorId,
            supplierPrices: { create: [{ supplierId: request.supplierId, batchCost: request.totalCost, batchUnits: request.quantity, freightCost, isPrimary: true }] },
          },
          select: { id: true, code: true },
        });
        if (!(await movePurchase(tx, source, item.id, created.id, params.actorId))) throw new Error(CHANGED);
        return { item, created };
      })
      .catch((e: unknown) => {
        if (e instanceof Error && e.message === CHANGED) return null;
        throw e;
      });
    if (!result) return { ok: false, error: CHANGED, status: 409 };
    target = result.item;
    proposal = result.created;
    // Aviso 1 a la asesora B2B, igual que cuando Bryan aprueba una propuesta.
    await notifyPublishersOfApproval(proposal.code, name).catch(() => null);
  }

  // Avisa a las otras partes: quien pidió, Bryan y Daniel.
  const code = request.requestNumber ? `${formatPurchaseRequestCode(request.requestNumber)} · ` : "";
  const inventoryLead = await prisma.user.findFirst({ where: { isLeader: true, isActive: true, leadsDept: { code: "INV" } }, select: { id: true } });
  const recipients = new Set([request.requestedById, inventoryLead?.id, ...(await getPurchaseApproverIds())].filter((id): id is string => !!id && id !== params.actorId));
  const toLabel = target.justCode ? `${target.name} (${target.justCode})` : `${target.name} (producto nuevo ${proposal?.code}, falta su ID de Dropi)`;
  await Promise.all(
    [...recipients].map((id) =>
      notifyOwner(id, {
        title: "Compra pasada a otro ID",
        body: `${code}${request.catalogItem.name}${request.catalogItem.justCode ? ` (${request.catalogItem.justCode})` : ""} es otro modelo — ahora va como ${toLabel}. No se mezcla en bodega.`,
        url: "/area/workspace",
      }).catch(() => null)
    )
  );

  return { ok: true, catalogItemId: target.id, name: target.name, justCode: target.justCode, proposalCode: proposal?.code ?? null };
}
