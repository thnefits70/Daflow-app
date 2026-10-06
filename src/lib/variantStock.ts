import { prisma } from "@/lib/prisma";
import { getVariantResolver } from "@/lib/variantSales";

// Stock por variante (pedido del usuario 2026-10-06). Es un DESGLOSE del
// Kardex, que sigue siendo el stock oficial del producto (costos, total):
// cada color/talla suma sus movimientos (ProductVariantMovement) y lo que no
// se sabe de qué color fue queda como "Sin identificar" = Kardex − suma.
// Mueven el desglose:
// - COUNT: el conteo físico aprobado (deja cada variante en lo contado).
// - SALE: el corte que Daniel confirma, según el color/talla de las guías.
// - PURCHASE: la compra que entra al Kardex, según lo que escribió quien
//   recibió.
// - RETURN: la devolución escaneada, según el color que eligió Joel.
// Daños, garantías, ventas externas y ajustes todavía no traen color/talla:
// mueven solo el Kardex y se ven en "Sin identificar" hasta el siguiente
// conteo por área.
// Nada de esto frena el Kardex: si falla, se registra en el log y sigue.

type VariantCount = { name: string; qty: number };

async function balances(variantIds: string[]): Promise<Map<string, number>> {
  if (variantIds.length === 0) return new Map();
  const rows = await prisma.productVariantMovement.groupBy({ by: ["variantId"], where: { variantId: { in: variantIds } }, _sum: { quantity: true } });
  return new Map(rows.map((r) => [r.variantId, r._sum.quantity ?? 0]));
}

async function findOrCreateVariant(catalogItemId: string, name: string, existing: { id: string; name: string }[]): Promise<string> {
  const same = existing.find((e) => e.name.toLowerCase() === name.toLowerCase());
  if (same) return same.id;
  const v = await prisma.productVariant.upsert({
    where: { catalogItemId_name: { catalogItemId, name } },
    update: {},
    create: { catalogItemId, name },
    select: { id: true, name: true },
  });
  existing.push(v);
  return v.id;
}

// Conteo aprobado: cada variante del producto queda en lo contado (las que
// no aparecieron, en 0). Se guarda la diferencia contra su saldo actual.
export async function applyCountToVariants(catalogItemId: string, counted: VariantCount[], countId: string): Promise<void> {
  const existing = await prisma.productVariant.findMany({ where: { catalogItemId }, select: { id: true, name: true } });
  for (const v of counted) await findOrCreateVariant(catalogItemId, v.name, existing);
  const bal = await balances(existing.map((e) => e.id));
  const rows = existing.map((e) => {
    const target = counted.find((v) => v.name.toLowerCase() === e.name.toLowerCase())?.qty ?? 0;
    return { variantId: e.id, quantity: target - (bal.get(e.id) ?? 0), reason: "COUNT", refId: countId };
  });
  await prisma.productVariantMovement.createMany({ data: rows.filter((r) => r.quantity !== 0), skipDuplicates: true });
}

// Compra que entró al Kardex: suma lo que se recibió de cada color/talla.
export async function applyReceiptToVariants(receiptId: string): Promise<void> {
  const receipt = await prisma.purchaseRequestReceipt.findUnique({
    where: { id: receiptId },
    select: { variantCounts: true, request: { select: { catalogItemId: true } } },
  });
  const counts = Array.isArray(receipt?.variantCounts) ? (receipt.variantCounts as VariantCount[]) : [];
  if (!receipt || counts.length === 0) return;
  const catalogItemId = receipt.request.catalogItemId;
  const existing = await prisma.productVariant.findMany({ where: { catalogItemId }, select: { id: true, name: true } });
  const rows: { variantId: string; quantity: number; reason: string; refId: string }[] = [];
  for (const c of counts) {
    if (c.qty <= 0) continue;
    rows.push({ variantId: await findOrCreateVariant(catalogItemId, c.name, existing), quantity: c.qty, reason: "PURCHASE", refId: receiptId });
  }
  await prisma.productVariantMovement.createMany({ data: rows, skipDuplicates: true });
}

// Corte cerrado: resta de cada color/talla lo que dicen las guías de ese
// corte, sin pasar de lo que de verdad salió del producto (despacho
// confirmado por Daniel). Lo que no se une a la lista oficial queda en
// "Sin identificar".
export async function applyLotSalesToVariants(lotId: string, dispatchedByItem: Map<string, number>): Promise<void> {
  const itemIds = [...dispatchedByItem.keys()].filter((id) => (dispatchedByItem.get(id) ?? 0) > 0);
  if (itemIds.length === 0) return;
  const official = await prisma.productVariant.findMany({ where: { catalogItemId: { in: itemIds } }, select: { id: true, catalogItemId: true, name: true } });
  if (official.length === 0) return;
  const withList = new Set(official.map((v) => v.catalogItemId));
  const notes = await prisma.fulfillmentRequestVariantNote.findMany({
    where: { batch: { lotId }, catalogItemId: { in: [...withList] } },
    select: { catalogItemId: true, label: true, quantity: true },
  });
  const resolve = await getVariantResolver([...withList]);
  const perItem = new Map<string, Map<string, number>>();
  for (const n of notes) {
    const name = resolve(n.catalogItemId, n.label);
    const v = name ? official.find((o) => o.catalogItemId === n.catalogItemId && o.name.toLowerCase() === name.toLowerCase()) : undefined;
    if (!v || n.quantity <= 0) continue;
    let m = perItem.get(n.catalogItemId);
    if (!m) perItem.set(n.catalogItemId, (m = new Map()));
    m.set(v.id, (m.get(v.id) ?? 0) + n.quantity);
  }
  const rows: { variantId: string; quantity: number; reason: string; refId: string }[] = [];
  for (const [itemId, m] of perItem) {
    let left = dispatchedByItem.get(itemId) ?? 0;
    for (const [variantId, qty] of [...m].sort((a, b) => b[1] - a[1])) {
      const take = Math.min(qty, left);
      if (take <= 0) break;
      rows.push({ variantId, quantity: -take, reason: "SALE", refId: lotId });
      left -= take;
    }
  }
  await prisma.productVariantMovement.createMany({ data: rows, skipDuplicates: true });
}

export type VariantStock = { variants: { id: string; name: string; stock: number }[]; unidentified: number };

// Desglose por color/talla de cada producto que ya tiene lista oficial.
export async function getVariantStock(catalogItemIds: string[]): Promise<Map<string, VariantStock>> {
  if (catalogItemIds.length === 0) return new Map();
  const official = await prisma.productVariant.findMany({ where: { catalogItemId: { in: catalogItemIds } }, select: { id: true, catalogItemId: true, name: true }, orderBy: { name: "asc" } });
  if (official.length === 0) return new Map();
  const ids = [...new Set(official.map((v) => v.catalogItemId))];
  const [bal, kardex] = await Promise.all([
    balances(official.map((v) => v.id)),
    prisma.stockKardexEntry.findMany({
      where: { catalogItemId: { in: ids } },
      distinct: ["catalogItemId"],
      orderBy: [{ catalogItemId: "asc" }, { occurredAt: "desc" }, { createdAt: "desc" }],
      select: { catalogItemId: true, balanceAfter: true },
    }),
  ]);
  const total = new Map(kardex.map((k) => [k.catalogItemId, k.balanceAfter]));
  const out = new Map<string, VariantStock>();
  for (const id of ids) {
    const variants = official
      .filter((v) => v.catalogItemId === id)
      .map((v) => ({ id: v.id, name: v.name, stock: bal.get(v.id) ?? 0 }))
      .sort((a, b) => b.stock - a.stock || a.name.localeCompare(b.name));
    const sum = variants.reduce((s, v) => s + v.stock, 0);
    out.set(id, { variants, unidentified: (total.get(id) ?? 0) - sum });
  }
  return out;
}

// ---- Devoluciones (Reingreso por escaneo, pedido del usuario 2026-10-06) ----
// La etiqueta de la guía no trae el color, así que Joel dice de qué
// color/talla son las buenas de cada producto (total del lote, no por guía).

export type ReentryVariantProduct = { catalogItemId: string; name: string; variantNames: string[]; good: number; variantCounts: VariantCount[] | null; ok: boolean };

// Productos del lote escaneado que tienen lista oficial: cuántas buenas hay
// (escaneadas − dañadas − faltantes) y si el desglose ya cuadra. Solo antes
// de enviar (después las dañadas ya se descontaron de las buenas).
export async function getReentryVariantStatus(batchId: string): Promise<ReentryVariantProduct[]> {
  const items = await prisma.merchandiseReentryItem.findMany({
    where: { batchId, catalogItemId: { not: null }, OR: [{ guideId: { not: null } }, { scanDamage: true }] },
    select: { catalogItemId: true, guideId: true, scanDamage: true, goodQty: true, damagedQty: true, missingQty: true, variantCounts: true, catalogItem: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const ids = [...new Set(items.map((i) => i.catalogItemId!))];
  if (ids.length === 0) return [];
  const official = await prisma.productVariant.findMany({ where: { catalogItemId: { in: ids } }, select: { catalogItemId: true, name: true }, orderBy: { name: "asc" } });
  const out: ReentryVariantProduct[] = [];
  for (const id of ids) {
    const names = official.filter((v) => v.catalogItemId === id).map((v) => v.name);
    if (names.length === 0) continue;
    const mine = items.filter((i) => i.catalogItemId === id);
    const scanned = mine.filter((i) => i.guideId).reduce((s, i) => s + i.goodQty, 0);
    const off = mine.filter((i) => i.scanDamage).reduce((s, i) => s + i.damagedQty + i.missingQty, 0);
    const good = Math.max(0, scanned - off);
    const first = mine.find((i) => i.guideId);
    const counts = Array.isArray(first?.variantCounts) ? (first.variantCounts as VariantCount[]) : null;
    const sum = counts?.reduce((s, v) => s + v.qty, 0) ?? 0;
    out.push({ catalogItemId: id, name: mine[0].catalogItem?.name ?? "Producto", variantNames: names, good, variantCounts: counts, ok: good === 0 || (counts !== null && sum === good) });
  }
  return out;
}

export async function setReentryVariants(batchId: string, catalogItemId: string, raw: VariantCount[]): Promise<{ ok: true } | { ok: false; error: string }> {
  const status = (await getReentryVariantStatus(batchId)).find((p) => p.catalogItemId === catalogItemId);
  if (!status) return { ok: false, error: "Este producto no tiene colores/tallas registrados." };
  const list = raw.map((v) => ({ name: v.name.replace(/\s+/g, " ").trim(), qty: v.qty })).filter((v) => v.name && v.qty > 0);
  if (new Set(list.map((v) => v.name.toLowerCase())).size !== list.length) return { ok: false, error: "Un color/talla está repetido." };
  const sum = list.reduce((s, v) => s + v.qty, 0);
  if (sum !== status.good) return { ok: false, error: `La suma tiene que dar ${status.good} (las buenas de este producto).` };
  await prisma.merchandiseReentryItem.updateMany({ where: { batchId, catalogItemId, guideId: { not: null } }, data: { variantCounts: list } });
  return { ok: true };
}

// Lo bueno que entra al Kardex suma a cada color/talla (una sola vez por
// producto y lote, aunque venga en varias guías).
export async function applyReturnToVariants(batchId: string, catalogItemId: string, counts: VariantCount[]): Promise<void> {
  const existing = await prisma.productVariant.findMany({ where: { catalogItemId }, select: { id: true, name: true } });
  const rows: { variantId: string; quantity: number; reason: string; refId: string }[] = [];
  for (const c of counts) {
    if (c.qty <= 0) continue;
    rows.push({ variantId: await findOrCreateVariant(catalogItemId, c.name, existing), quantity: c.qty, reason: "RETURN", refId: `${batchId}:${catalogItemId}` });
  }
  await prisma.productVariantMovement.createMany({ data: rows, skipDuplicates: true });
}
