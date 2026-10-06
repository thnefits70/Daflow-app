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
// confirmado por Daniel). Lo que salió sin color en la guía se descuenta
// del color que el equipo dijo que sacó; si no dijo, queda en
// "Sin identificar".
export async function applyLotSalesToVariants(lotId: string, dispatchedByItem: Map<string, number>, warrantyByItem: Map<string, number> = new Map()): Promise<void> {
  const itemIds = [...new Set([...dispatchedByItem.keys(), ...warrantyByItem.keys()])].filter((id) => (dispatchedByItem.get(id) ?? 0) + (warrantyByItem.get(id) ?? 0) > 0);
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
  // Lo que salió "Sin variante" en las guías: el color que el equipo dijo
  // que sacó de la percha (2026-10-06).
  const picks = await prisma.fulfillmentLotPick.findMany({ where: { lotId, catalogItemId: { in: [...withList] } }, select: { catalogItemId: true, variantCounts: true } });
  const pickedBy = new Map(picks.map((p) => [p.catalogItemId, Array.isArray(p.variantCounts) ? (p.variantCounts as VariantCount[]) : []]));
  const total = new Map<string, number>(); // variante → unidades que salen
  for (const itemId of withList) {
    let left = dispatchedByItem.get(itemId) ?? 0;
    const fromGuides = [...(perItem.get(itemId) ?? new Map<string, number>())].sort((a, b) => b[1] - a[1]);
    const fromPick = (pickedBy.get(itemId) ?? [])
      .map((c) => [official.find((o) => o.catalogItemId === itemId && o.name.toLowerCase() === c.name.toLowerCase())?.id, c.qty] as const)
      .filter((x): x is readonly [string, number] => !!x[0]);
    for (const [variantId, qty] of [...fromGuides, ...fromPick]) {
      const take = Math.min(qty, left);
      if (take <= 0) continue;
      total.set(variantId, (total.get(variantId) ?? 0) + take);
      left -= take;
    }
  }
  // Garantías completas o de parte del combo (2026-10-06): el color/talla que
  // traía la etiqueta de la guía de garantía, sin pasar de lo que salió
  // como garantía. Las de "solo una pieza" no tocan el stock del producto.
  const warrantyItems = await prisma.fulfillmentRequestItem.findMany({
    where: { batch: { lotId }, catalogItemId: { in: [...withList] }, warrantyGuide: { not: null }, warrantyMode: { in: ["COMPLETE", "PARTIAL"] }, warrantyPiece: { not: null } },
    select: { catalogItemId: true, quantity: true, warrantyPiece: true },
  });
  for (const itemId of withList) {
    let left = warrantyByItem.get(itemId) ?? 0;
    for (const w of warrantyItems.filter((x) => x.catalogItemId === itemId)) {
      const name = resolve(itemId, w.warrantyPiece!);
      const v = name ? official.find((o) => o.catalogItemId === itemId && o.name.toLowerCase() === name.toLowerCase()) : undefined;
      const take = v ? Math.min(w.quantity, left) : 0;
      if (take <= 0) continue;
      total.set(v!.id, (total.get(v!.id) ?? 0) + take);
      left -= take;
    }
  }
  const rows = [...total].map(([variantId, qty]) => ({ variantId, quantity: -qty, reason: "SALE", refId: lotId }));
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
// Cada producto devuelto guarda su color/talla en variantCounts: lo que dice
// la etiqueta de la guía se pone solo al escanear; lo que la guía no dice lo
// completa Joel (manual: true). Se pide para todas las unidades escaneadas
// (antes de apartar dañadas): las dañadas salen de ahí al entrar al stock.

type ReturnCount = VariantCount & { manual?: boolean };

export type ReentryVariantProduct = {
  catalogItemId: string;
  name: string;
  variantNames: string[];
  scanned: number;
  detected: VariantCount[];
  manual: VariantCount[];
  needed: number;
  ok: boolean;
};

function sumUp(list: VariantCount[]): VariantCount[] {
  const m = new Map<string, number>();
  for (const v of list) m.set(v.name, (m.get(v.name) ?? 0) + v.qty);
  return [...m].map(([name, qty]) => ({ name, qty }));
}

async function guideItemsOf(batchId: string) {
  return prisma.merchandiseReentryItem.findMany({
    where: { batchId, catalogItemId: { not: null }, guideId: { not: null } },
    select: { id: true, catalogItemId: true, goodQty: true, variantCounts: true, catalogItem: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
}

const countsOf = (json: unknown): ReturnCount[] => (Array.isArray(json) ? (json as ReturnCount[]) : []);

// Productos del lote escaneado que tienen lista oficial: lo que leyó DAFLOW
// de las guías y cuántas unidades faltan por decir de qué color son.
export async function getReentryVariantStatus(batchId: string): Promise<ReentryVariantProduct[]> {
  const items = await guideItemsOf(batchId);
  const ids = [...new Set(items.map((i) => i.catalogItemId!))];
  if (ids.length === 0) return [];
  const official = await prisma.productVariant.findMany({ where: { catalogItemId: { in: ids } }, select: { catalogItemId: true, name: true }, orderBy: { name: "asc" } });
  const out: ReentryVariantProduct[] = [];
  for (const id of ids) {
    const names = official.filter((v) => v.catalogItemId === id).map((v) => v.name);
    if (names.length === 0) continue;
    const mine = items.filter((i) => i.catalogItemId === id);
    const all = mine.flatMap((i) => countsOf(i.variantCounts));
    const detected = sumUp(all.filter((v) => !v.manual));
    const manual = sumUp(all.filter((v) => v.manual));
    const scanned = mine.reduce((s, i) => s + i.goodQty, 0);
    const needed = Math.max(0, scanned - detected.reduce((s, v) => s + v.qty, 0));
    out.push({ catalogItemId: id, name: mine[0].catalogItem?.name ?? "Producto", variantNames: names, scanned, detected, manual, needed, ok: manual.reduce((s, v) => s + v.qty, 0) === needed });
  }
  return out;
}

// Joel dice de qué color son las unidades que la guía no decía. Se reparte
// entre las guías de ese producto que tienen unidades sin color.
export async function setReentryVariants(batchId: string, catalogItemId: string, raw: VariantCount[]): Promise<{ ok: true } | { ok: false; error: string }> {
  const status = (await getReentryVariantStatus(batchId)).find((p) => p.catalogItemId === catalogItemId);
  if (!status) return { ok: false, error: "Este producto no tiene colores/tallas registrados." };
  const list = raw.map((v) => ({ name: v.name.replace(/\s+/g, " ").trim(), qty: v.qty })).filter((v) => v.name && v.qty > 0);
  if (list.some((v) => !status.variantNames.includes(v.name))) return { ok: false, error: "Elige un color/talla de la lista." };
  if (list.reduce((s, v) => s + v.qty, 0) !== status.needed) return { ok: false, error: `La suma tiene que dar ${status.needed}.` };
  const queue = list.map((v) => ({ ...v }));
  const items = (await guideItemsOf(batchId)).filter((i) => i.catalogItemId === catalogItemId);
  await prisma.$transaction(
    items.map((i) => {
      const detected = countsOf(i.variantCounts).filter((v) => !v.manual);
      let gap = i.goodQty - detected.reduce((s, v) => s + v.qty, 0);
      const chunk: ReturnCount[] = [];
      for (const q of queue) {
        if (gap <= 0) break;
        const take = Math.min(gap, q.qty);
        if (take <= 0) continue;
        chunk.push({ name: q.name, qty: take, manual: true });
        q.qty -= take;
        gap -= take;
      }
      return prisma.merchandiseReentryItem.update({ where: { id: i.id }, data: { variantCounts: [...detected, ...chunk] } });
    })
  );
  return { ok: true };
}

// Lo bueno que entra al Kardex suma a cada color/talla, sin pasar de las
// buenas de esa fila (las dañadas ya se descontaron).
export async function applyReturnToVariants(itemId: string, catalogItemId: string, goodQty: number, counts: VariantCount[]): Promise<void> {
  const existing = await prisma.productVariant.findMany({ where: { catalogItemId }, select: { id: true, name: true } });
  const rows: { variantId: string; quantity: number; reason: string; refId: string }[] = [];
  let left = goodQty;
  for (const c of sumUp(counts)) {
    const qty = Math.min(c.qty, left);
    if (qty <= 0) break;
    rows.push({ variantId: await findOrCreateVariant(catalogItemId, c.name, existing), quantity: qty, reason: "RETURN", refId: itemId });
    left -= qty;
  }
  await prisma.productVariantMovement.createMany({ data: rows, skipDuplicates: true });
}

// Color/talla que dice la etiqueta de la guía devuelta, por producto, ya
// unido a la lista oficial (solo productos que la tienen). Lo que la
// etiqueta no dice, o que no se une a la lista, lo completa Joel.
export async function detectReturnVariants(params: {
  fulfillmentBatchId: string;
  labelVariants: { code: string; variant: string | null; qty: number }[];
  lines: { catalogItemId: string; quantity: number }[];
}): Promise<Map<string, VariantCount[]>> {
  const out = new Map<string, VariantCount[]>();
  const ids = params.lines.map((l) => l.catalogItemId);
  const withVariant = params.labelVariants.filter((v) => v.variant && v.qty > 0);
  if (ids.length === 0 || withVariant.length === 0) return out;
  const official = await prisma.productVariant.findMany({ where: { catalogItemId: { in: ids } }, select: { catalogItemId: true, name: true } });
  if (official.length === 0) return out;
  // Código de la etiqueta → producto, como salió en ese corte (sin combos:
  // en un combo no se sabe a qué pieza va el color).
  const corteItems = await prisma.fulfillmentRequestItem.findMany({
    where: { batchId: params.fulfillmentBatchId, fromComboCode: null, sourceCode: { in: withVariant.map((v) => v.code) } },
    select: { sourceCode: true, catalogItemId: true },
  });
  const resolve = await getVariantResolver(ids);
  for (const v of withVariant) {
    const items = [...new Set(corteItems.filter((c) => c.sourceCode === v.code).map((c) => c.catalogItemId))];
    if (items.length !== 1) continue;
    const itemId = items[0];
    const line = params.lines.find((l) => l.catalogItemId === itemId);
    const name = resolve(itemId, v.variant!);
    const off = name ? official.find((o) => o.catalogItemId === itemId && o.name.toLowerCase() === name.toLowerCase()) : undefined;
    if (!line || !off) continue;
    const list = out.get(itemId) ?? [];
    const room = line.quantity - list.reduce((s, x) => s + x.qty, 0);
    const qty = Math.min(v.qty, room);
    if (qty <= 0) continue;
    const same = list.find((x) => x.name === off.name);
    if (same) same.qty += qty;
    else list.push({ name: off.name, qty });
    out.set(itemId, list);
  }
  return out;
}

// ---- Cortes: unidades "Sin variante" (pedido del usuario 2026-10-06) ----
// Cuántas unidades normales de cada producto (con lista oficial) salieron en
// las guías del corte SIN un color/talla que se una a la lista. De esas, el
// equipo de INVESTOCK dice qué color sacó de la percha.
export async function lotNoVariantUnits(lotId: string, lines: { catalogItemId: string; normalNeeded: number }[]): Promise<Map<string, { units: number; options: string[] }>> {
  const out = new Map<string, { units: number; options: string[] }>();
  const ids = lines.filter((l) => l.normalNeeded > 0).map((l) => l.catalogItemId);
  if (ids.length === 0) return out;
  const official = await prisma.productVariant.findMany({ where: { catalogItemId: { in: ids } }, select: { catalogItemId: true, name: true }, orderBy: { name: "asc" } });
  if (official.length === 0) return out;
  const withList = [...new Set(official.map((v) => v.catalogItemId))];
  const [notes, resolve] = await Promise.all([
    prisma.fulfillmentRequestVariantNote.findMany({ where: { batch: { lotId }, catalogItemId: { in: withList } }, select: { catalogItemId: true, label: true, quantity: true } }),
    getVariantResolver(withList),
  ]);
  for (const id of withList) {
    const options = official.filter((v) => v.catalogItemId === id).map((v) => v.name);
    const known = notes
      .filter((n) => n.catalogItemId === id)
      .reduce((s, n) => {
        const name = resolve(id, n.label);
        return s + (name && options.some((o) => o.toLowerCase() === name.toLowerCase()) ? n.quantity : 0);
      }, 0);
    const need = lines.find((l) => l.catalogItemId === id)?.normalNeeded ?? 0;
    out.set(id, { units: Math.max(0, need - known), options });
  }
  return out;
}
