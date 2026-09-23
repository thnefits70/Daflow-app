import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

// Confirmado 2026-09-23, pedido de Robert: "Nuevos IDs por brandear" sale de
// Mercadería recibida a su propia pestaña. Cada producto aparece UNA sola vez
// (no una vez por cada llegada) y, una vez brandeado, pasa al historial con
// sus fotos reales brandeadas, video(s) y la casilla "ya subido al canal de
// la marca". También absorbe la antigua pestaña "Brandear" de Análisis de
// Mercado: una propuesta con ID de Dropi confirmado por Heidy aparece acá
// aunque todavía no haya llegado a bodega.

// Mismo criterio que canConfirmMarketingDesign (admin solo mira, nunca
// confirma), aceptando también el flag viejo de la pestaña "Brandear".
export async function canBrandNewIds() {
  const session = await auth();
  if (!session || session.user.role === "admin") return false;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { canConfirmMarketingDesign: true, canBrandMarketProduct: true },
  });
  return !!(user?.canConfirmMarketingDesign || user?.canBrandMarketProduct);
}

export async function getNewIdBrandingActorIds(): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { isActive: true, OR: [{ canConfirmMarketingDesign: true }, { canBrandMarketProduct: true }] },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

export type NewIdEntry = {
  key: string; // "c:<catalogItemId>" o "p:<proposalId>"
  catalogItemId: string | null;
  proposalId: string | null;
  name: string;
  code: string | null;
  referencePhotos: string[];
  arrivalPhotos: string[];
  arrivedAt: string | null;
  arrivals: number;
  dropiPublishedAt: string | null;
  // Fecha desde la que está esperando brandeo (para ordenar lo más antiguo primero).
  since: string;
  branded: {
    at: string | null;
    by: string | null;
    photos: string[];
    videoUrls: string[];
    legacy: boolean; // brandeado antes de que existiera esta sección, sin fotos guardadas
  } | null;
  channel: { at: string; by: string | null } | null;
};

const ARRIVED = ["RECEIVED_PENDING_REVIEW", "RECEIVED"] as const;

export async function getNewIdBrandingBoard(): Promise<{ pending: NewIdEntry[]; done: NewIdEntry[] }> {
  const [arrivals, proposals, rows] = await Promise.all([
    prisma.purchaseRequest.findMany({
      where: { status: { in: [...ARRIVED] } },
      select: {
        catalogItemId: true,
        catalogItem: { select: { id: true, name: true, photos: true, justCode: true } },
        receipt: { select: { photoUrls: true, confirmedAt: true } },
        marketingFollowUp: { select: { designConfirmedAt: true, designConfirmedBy: { select: { name: true } } } },
      },
    }),
    prisma.marketProductProposal.findMany({
      where: { status: "APPROVED" },
      select: {
        id: true,
        productName: true,
        referenceImageUrl: true,
        dropiProductId: true,
        publishedAt: true,
        brandedAt: true,
        brandedBy: { select: { name: true } },
        catalogItemId: true,
      },
    }),
    prisma.newIdBranding.findMany({
      include: { brandedBy: { select: { name: true } }, channelUploadedBy: { select: { name: true } } },
    }),
  ]);

  const rowByCatalog = new Map(rows.filter((r) => r.catalogItemId).map((r) => [r.catalogItemId!, r]));
  const rowByProposal = new Map(rows.filter((r) => r.proposalId).map((r) => [r.proposalId!, r]));
  const proposalByCatalog = new Map(proposals.filter((p) => p.catalogItemId).map((p) => [p.catalogItemId!, p]));

  const entries = new Map<string, NewIdEntry>();

  // 1) Lo que llegó a bodega, agrupado por producto.
  for (const a of arrivals) {
    const key = `c:${a.catalogItemId}`;
    const confirmedAt = a.receipt?.confirmedAt ?? null;
    let e = entries.get(key);
    if (!e) {
      const prop = proposalByCatalog.get(a.catalogItemId);
      e = {
        key,
        catalogItemId: a.catalogItemId,
        proposalId: prop?.id ?? null,
        name: a.catalogItem.name,
        code: a.catalogItem.justCode ?? prop?.dropiProductId ?? null,
        referencePhotos: a.catalogItem.photos,
        arrivalPhotos: [],
        arrivedAt: null,
        arrivals: 0,
        dropiPublishedAt: prop?.publishedAt?.toISOString() ?? null,
        since: "",
        branded: null,
        channel: null,
      };
      entries.set(key, e);
    }
    e.arrivals++;
    // La primera llegada es la que manda (fecha y fotos reales).
    if (confirmedAt && (!e.arrivedAt || confirmedAt.toISOString() < e.arrivedAt)) {
      e.arrivedAt = confirmedAt.toISOString();
      e.arrivalPhotos = a.receipt?.photoUrls ?? [];
    }
    const fu = a.marketingFollowUp;
    if (fu?.designConfirmedAt && (!e.branded || (e.branded.at && fu.designConfirmedAt.toISOString() < e.branded.at))) {
      e.branded = { at: fu.designConfirmedAt.toISOString(), by: fu.designConfirmedBy?.name ?? null, photos: [], videoUrls: [], legacy: true };
    }
  }

  // 2) Propuestas de Análisis de Mercado con ID de Dropi confirmado.
  for (const p of proposals) {
    if (!p.publishedAt) continue;
    const key = p.catalogItemId ? `c:${p.catalogItemId}` : `p:${p.id}`;
    let e = entries.get(key);
    // Propuestas viejas (antes del 2026-09-18) nunca quedaron ligadas a su
    // catálogo: se juntan con el producto que llegó con el mismo ID o nombre
    // para no mostrar el mismo producto dos veces.
    if (!e && !p.catalogItemId) {
      const name = p.productName.trim().toLowerCase();
      e = [...entries.values()].find(
        (x) => x.catalogItemId && !x.proposalId && ((p.dropiProductId && x.code === p.dropiProductId) || x.name.trim().toLowerCase() === name)
      );
      if (e) {
        e.proposalId = p.id;
        e.dropiPublishedAt = p.publishedAt.toISOString();
        e.code = e.code ?? p.dropiProductId;
      }
    }
    if (!e) {
      e = {
        key,
        catalogItemId: p.catalogItemId,
        proposalId: p.id,
        name: p.productName,
        code: p.dropiProductId,
        referencePhotos: [p.referenceImageUrl],
        arrivalPhotos: [],
        arrivedAt: null,
        arrivals: 0,
        dropiPublishedAt: p.publishedAt.toISOString(),
        since: "",
        branded: null,
        channel: null,
      };
      entries.set(key, e);
    }
    if (p.brandedAt && !e.branded) {
      e.branded = { at: p.brandedAt.toISOString(), by: p.brandedBy?.name ?? null, photos: [], videoUrls: [], legacy: true };
    }
  }

  // 3) Lo guardado en esta sección manda sobre lo viejo.
  for (const e of entries.values()) {
    const row = (e.catalogItemId && rowByCatalog.get(e.catalogItemId)) || (e.proposalId && rowByProposal.get(e.proposalId)) || null;
    if (row?.brandedAt) {
      e.branded = { at: row.brandedAt.toISOString(), by: row.brandedBy?.name ?? null, photos: row.photos, videoUrls: row.videoUrls, legacy: false };
    }
    if (row?.channelUploadedAt) e.channel = { at: row.channelUploadedAt.toISOString(), by: row.channelUploadedBy?.name ?? null };
    e.since = e.dropiPublishedAt && (!e.arrivedAt || e.dropiPublishedAt < e.arrivedAt) ? e.dropiPublishedAt : e.arrivedAt ?? e.dropiPublishedAt ?? "";
  }

  // Un producto que viene de una propuesta todavía sin ID de Dropi (Heidy no
  // lo publicó) no se brandea aún — igual que la vieja pestaña "Brandear".
  const waitingDropi = new Set(proposals.filter((p) => !p.publishedAt && p.catalogItemId).map((p) => `c:${p.catalogItemId}`));

  const all = [...entries.values()];
  const pending = all
    .filter((e) => !e.branded && !waitingDropi.has(e.key))
    .sort((a, b) => a.since.localeCompare(b.since)); // lo más antiguo primero
  const done = all
    .filter((e) => e.branded)
    .sort((a, b) => (b.branded!.at ?? "").localeCompare(a.branded!.at ?? "")); // lo más reciente primero
  return { pending, done };
}

// ¿Este producto ya fue brandeado alguna vez? Usado por receipt/route.ts para
// no volver a avisarle a Robert en cada llegada repetida.
export async function isCatalogItemBranded(catalogItemId: string): Promise<boolean> {
  const [row, legacyFollowUp, proposal] = await Promise.all([
    prisma.newIdBranding.findUnique({ where: { catalogItemId }, select: { brandedAt: true } }),
    prisma.purchaseReceiptFollowUp.findFirst({ where: { designConfirmedAt: { not: null }, request: { catalogItemId } }, select: { id: true } }),
    prisma.marketProductProposal.findUnique({ where: { catalogItemId }, select: { brandedAt: true } }),
  ]);
  return !!(row?.brandedAt || legacyFollowUp || proposal?.brandedAt);
}
