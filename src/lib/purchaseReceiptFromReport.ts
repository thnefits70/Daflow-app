import { prisma } from "@/lib/prisma";
import { getInventoryLeadId } from "@/lib/guards";
import { notifyOwner } from "@/lib/notifications";
import { getMarketingArrivalActorIds, getMarketingArrivalDispatchViewerIds } from "@/lib/marketingArrivals";
import { isCatalogItemBranded, catalogItemNeedsRealPhotos, getNewIdBrandingActorIds } from "@/lib/newIdBranding";

// Avisos que salen apenas bodega deja registrada una recepción (antes vivían
// solo en [id]/receipt/route.ts — se comparten con el registro automático
// desde el reporte urgente de abajo). skipLeadNotice: si quien registra ES
// Daniel, no tiene sentido avisarle a él mismo que tiene algo por aprobar.
export async function notifyReceiptRegistered(params: { catalogItemId: string; itemName: string; quantity: number; skipLeadNotice?: boolean }) {
  const leadId = params.skipLeadNotice ? null : await getInventoryLeadId();
  if (leadId) {
    // Confirmado 2026-09-09: pedido explícito de Daniel — antes esto era solo
    // sendPushToOwner (push al dispositivo), que se pierde en silencio si el
    // permiso está revocado o la suscripción venció ("a veces sí llega, a
    // veces no"). notifyOwner además deja constancia en la campanita, así
    // que toda mercadería que llega físicamente a bodega queda visible ahí
    // aunque el push falle.
    await notifyOwner(leadId, {
      title: "Recepción pendiente de tu aprobación",
      body: `${params.itemName} — ${params.quantity} un. recibidas por el equipo, esperando que apruebes.`,
      url: "/area/workspace?tab=compras&ptab=inventario",
    });
  }

  // Confirmado 2026-09-16: aviso a Análisis de Mercado y despacho, movido acá
  // desde approve-receipt/route.ts — sale apenas bodega registra.
  const arrivalBody = `${params.itemName} · ${params.quantity} un.`;
  // Confirmado 2026-09-23, pedido de Robert: el brandeo es una sola vez por
  // producto — si ya se brandeó antes, esta llegada repetida no le pide nada.
  // Confirmado 2026-09-25, pedido de Robert: si ya estaba brandeado pero le
  // faltan las fotos reales, esta llegada es la señal para tomarlas.
  const [designIds, realPhotoIds, advisorIds, dispatchIds] = await Promise.all([
    isCatalogItemBranded(params.catalogItemId).then((done) => (done ? [] : getNewIdBrandingActorIds())),
    catalogItemNeedsRealPhotos(params.catalogItemId).then((need) => (need ? getNewIdBrandingActorIds() : [])),
    getMarketingArrivalActorIds("advisor"),
    getMarketingArrivalDispatchViewerIds(),
  ]);
  await Promise.all([
    ...designIds.map((uid) =>
      notifyOwner(uid, { title: "Nuevo ID por brandear", body: arrivalBody, url: "/area/workspace?tab=nuevos-ids" })
    ),
    ...realPhotoIds.map((uid) =>
      notifyOwner(uid, { title: "Ya llegó — toma las imágenes reales", body: arrivalBody, url: "/area/workspace?tab=nuevos-ids" })
    ),
    ...advisorIds.map((uid) =>
      notifyOwner(uid, { title: "Llegó mercadería a bodega", body: arrivalBody, url: "/area/workspace?tab=llegadas" })
    ),
    ...dispatchIds.map((uid) =>
      notifyOwner(uid, { title: "Llegó mercadería a bodega", body: `${arrivalBody} — ya puedes ir organizando el despacho.`, url: "/area/workspace?tab=llegadas" })
    ),
  ]);
}

const VIDEO_RE = /\.(mp4|mov|webm|3gp|m4v|mkv)(\?|$)/i;

// Confirmado 2026-09-24, pedido de Daniel (video con los casos de Joel/Scott:
// Kit Pulidor 240 contadas vs 200 pedidas, Almohada 25 de 75): cuando el
// equipo ya mandó el reporte urgente (conteo + fotos + comentario), no se le
// vuelve a pedir "Confirmar X un. buenas" con fotos otra vez — era un doble
// proceso con la misma información. Apenas Daniel aprueba el reporte, la
// parte BUENA queda registrada sola con la evidencia del reporte, y sigue
// quedando en RECEIVED_PENDING_REVIEW: Daniel igual da el visto bueno final
// (approve-receipt/route.ts, que es lo que corre el Kardex de INVESTOCK) —
// el usuario eligió mantener ese control.
// Devuelve null si todavía no corresponde (ya tiene recepción, falta que
// Daniel revise algún reporte, no está pagada, o no queda nada bueno).
export async function registerGoodUnitsFromUrgentReport(requestId: string, actor: { id: string; isAdmin: boolean; isLead: boolean }) {
  const existing = await prisma.purchaseRequest.findUnique({
    where: { id: requestId },
    include: {
      catalogItem: { select: { name: true } },
      urgentReports: { where: { isLateClaim: false }, orderBy: { reportedAt: "asc" } },
      supplier: { select: { paymentMode: true } },
      receipt: { select: { id: true } },
    },
  });
  if (!existing || existing.receipt || existing.urgentReports.length === 0) return null;
  const isCreditSupplier = existing.supplier.paymentMode === "CREDITO";
  if (existing.status !== "PAID" && !(isCreditSupplier && existing.status === "APPROVED")) return null;
  if (existing.urgentReports.some((r) => !r.reviewedByLeadAt || r.rejectedAt)) return null;

  const totalAffected = existing.urgentReports.reduce((s, r) => s + r.damagedQty + r.incompleteQty + r.differentQty + r.missingQty, 0);
  const goodQty = existing.quantity - totalAffected;
  if (goodQty <= 0) return null;

  const media = existing.urgentReports.flatMap((r) => r.mediaUrls);
  const comment = `Registrado desde el reporte urgente — ${existing.urgentReports.map((r) => `"${r.description}"`).join(" · ")}`;

  const [receipt] = await prisma.$transaction([
    prisma.purchaseRequestReceipt.create({
      data: {
        requestId,
        receivedQuantity: goodQty,
        photoUrls: media.filter((u) => !VIDEO_RE.test(u)),
        videoUrls: media.filter((u) => VIDEO_RE.test(u)),
        comment,
        // Quien de verdad contó y reportó es quien recibió físicamente.
        confirmedById: existing.urgentReports[0].reportedById ?? (actor.isAdmin ? null : actor.id),
      },
    }),
    prisma.purchaseRequest.update({ where: { id: requestId }, data: { status: "RECEIVED_PENDING_REVIEW" } }),
    prisma.purchaseReceiptFollowUp.create({ data: { requestId } }),
  ]);

  await notifyReceiptRegistered({ catalogItemId: existing.catalogItemId, itemName: existing.catalogItem.name, quantity: goodQty, skipLeadNotice: actor.isLead }).catch((err) =>
    console.error("[registerGoodUnitsFromUrgentReport] avisos:", err)
  );
  return receipt;
}
