import { prisma } from "@/lib/prisma";
import { applyCountToVariants, getVariantStock } from "@/lib/variantStock";

// Variantes organizadas como en Dropi (pedido de DANIEL 2026-10-17, plan
// aprobado por el usuario): por cada ID madre, DANIEL pone cada variante con
// su ID de variación de Dropi (ej. 76777), el nombre exacto de Dropi y lo que
// contó en bodega. Va como "Ajustar (conteo)": el admin lo aprueba y recién
// ahí se aplica. Solo DANIEL (líder de Inventario) y el admin.
// Al aprobar:
// - cada línea toma la variante de DAFLOW que reemplaza (o se crea), con el
//   nombre de Dropi; el nombre viejo queda como alias (guías, conteos y
//   compras viejas caen en la variante correcta);
// - una variante que ya tenía ese nombre y no se eligió se junta con esa línea;
// - el stock de cada variante queda en lo contado y el total del Kardex en la suma;
// - las variantes que no se usaron y quedaron en 0 se quitan ("Sin talla" se deja).

export type DropiVariantLine = { dropiId: string; name: string; qty: number; previousId: string | null };

const KEEP_NAMES = new Set(["sin talla"]);

export function cleanDropiLines(raw: DropiVariantLine[], total: number): DropiVariantLine[] {
  if (raw.length === 0) throw new Error("Agrega al menos una variante.");
  const list = raw.map((l) => ({ dropiId: l.dropiId.replace(/\D/g, ""), name: l.name.replace(/\s+/g, " ").trim(), qty: l.qty, previousId: l.previousId || null }));
  if (list.some((l) => !l.dropiId)) throw new Error("Cada variante necesita su ID de variación de Dropi (solo números, ej. 76777).");
  if (list.some((l) => !l.name || l.name.length > 60)) throw new Error("Escribe el nombre de cada variante tal como está en Dropi.");
  if (list.some((l) => !Number.isInteger(l.qty) || l.qty < 0)) throw new Error("Cada variante debe tener un número entero, 0 o mayor.");
  if (new Set(list.map((l) => l.name.toLowerCase())).size !== list.length) throw new Error("Hay un nombre de variante repetido.");
  if (new Set(list.map((l) => l.dropiId)).size !== list.length) throw new Error("Hay un ID de variación de Dropi repetido.");
  const prev = list.map((l) => l.previousId).filter(Boolean);
  if (new Set(prev).size !== prev.length) throw new Error("Una variante de DAFLOW está elegida en dos líneas.");
  if (list.reduce((s, l) => s + l.qty, 0) !== total) throw new Error("La suma de las variantes no da el total contado.");
  return list;
}

export function parseDropiLines(json: unknown): DropiVariantLine[] | null {
  return Array.isArray(json) ? (json as DropiVariantLine[]) : null;
}

export async function checkPreviousBelongToItem(catalogItemId: string, lines: DropiVariantLine[]): Promise<void> {
  const ids = lines.map((l) => l.previousId).filter((x): x is string => !!x);
  if (ids.length === 0) return;
  const found = await prisma.productVariant.count({ where: { id: { in: ids }, catalogItemId } });
  if (found !== ids.length) throw new Error("Alguna variante de DAFLOW ya no existe. Recarga la página.");
}

async function balanceOf(variantId: string): Promise<number> {
  const r = await prisma.productVariantMovement.aggregate({ where: { variantId }, _sum: { quantity: true } });
  return r._sum.quantity ?? 0;
}

// Se llama al aprobar (o cuando el admin lo hace directo), después de que el
// Kardex ya quedó en el total. refId = movimiento de Kardex del ajuste.
export async function applyDropiOrganization(catalogItemId: string, rawLines: DropiVariantLine[], refId: string, who: { userId: string | null; userName: string | null }): Promise<void> {
  const lines = rawLines.map((l) => ({ ...l }));
  const existing = await prisma.productVariant.findMany({ where: { catalogItemId }, select: { id: true, name: true } });
  const exists = new Set(existing.map((e) => e.id));
  for (const l of lines) if (l.previousId && !exists.has(l.previousId)) l.previousId = null;
  // 1. Línea sin variante elegida: si ya hay una con ese nombre (libre), es esa.
  const used = new Set(lines.map((l) => l.previousId).filter(Boolean));
  for (const l of lines) {
    if (l.previousId) continue;
    const same = existing.find((e) => !used.has(e.id) && e.name.toLowerCase() === l.name.toLowerCase());
    if (same) {
      l.previousId = same.id;
      used.add(same.id);
    }
  }
  const log: string[] = [];
  // 2. Una variante libre con el nombre de una línea que ya eligió otra: se junta con ella.
  for (const l of lines) {
    if (!l.previousId) continue;
    const clash = existing.find((e) => !used.has(e.id) && e.name.toLowerCase() === l.name.toLowerCase());
    if (!clash) continue;
    const qty = await balanceOf(clash.id);
    await prisma.$transaction([
      ...(qty !== 0 ? [prisma.productVariantMovement.create({ data: { variantId: l.previousId, quantity: qty, reason: "MERGE", refId: `DROPI-${refId}:${clash.id}` } })] : []),
      prisma.productVariantAlias.updateMany({ where: { variantId: clash.id }, data: { variantId: l.previousId } }),
      prisma.productVariant.delete({ where: { id: clash.id } }),
    ]);
    used.add(clash.id);
    log.push(`juntó «${clash.name}»`);
  }
  // 3. Nombres de Dropi: primero un nombre provisional (para poder intercambiar nombres sin chocar).
  const renames = lines.filter((l) => l.previousId).map((l) => ({ l, old: existing.find((e) => e.id === l.previousId)! }));
  await prisma.$transaction(renames.map(({ l }) => prisma.productVariant.update({ where: { id: l.previousId! }, data: { name: `~${l.previousId}` } })));
  const ops = [];
  for (const { l, old } of renames) {
    ops.push(prisma.productVariantAlias.deleteMany({ where: { catalogItemId, label: { equals: l.name, mode: "insensitive" } } }));
    ops.push(prisma.productVariant.update({ where: { id: l.previousId! }, data: { name: l.name, dropiVariantId: l.dropiId } }));
    if (old.name.toLowerCase() !== l.name.toLowerCase()) {
      ops.push(
        prisma.productVariantAlias.upsert({
          where: { catalogItemId_label: { catalogItemId, label: old.name } },
          update: { variantId: l.previousId!, ignored: false, decidedById: who.userId, decidedAt: new Date() },
          create: { catalogItemId, label: old.name, variantId: l.previousId!, decidedById: who.userId },
        }),
      );
      log.push(`«${old.name}» → «${l.name}» (#${l.dropiId})`);
    } else log.push(`«${l.name}» (#${l.dropiId})`);
  }
  for (const l of lines.filter((x) => !x.previousId)) {
    ops.push(prisma.productVariantAlias.deleteMany({ where: { catalogItemId, label: { equals: l.name, mode: "insensitive" } } }));
    ops.push(prisma.productVariant.create({ data: { catalogItemId, name: l.name, dropiVariantId: l.dropiId } }));
    log.push(`nueva «${l.name}» (#${l.dropiId})`);
  }
  await prisma.$transaction(ops);
  // 4. Stock de cada variante = lo contado.
  await applyCountToVariants(catalogItemId, lines.map((l) => ({ name: l.name, qty: l.qty })), refId);
  // 5. Las que no se usaron y quedaron en 0 se quitan.
  const leftovers = await prisma.productVariant.findMany({ where: { catalogItemId, dropiVariantId: null }, select: { id: true, name: true } });
  const removed: string[] = [];
  for (const v of leftovers) {
    if (KEEP_NAMES.has(v.name.toLowerCase())) continue;
    if ((await balanceOf(v.id)) !== 0) continue;
    await prisma.productVariant.delete({ where: { id: v.id } });
    removed.push(v.name);
  }
  if (removed.length) log.push(`quitó ${removed.map((n) => `«${n}»`).join(", ")}`);
  await prisma.$transaction([
    prisma.purchaseCatalogItem.update({ where: { id: catalogItemId }, data: { variantsOrganizedAt: new Date() } }),
    prisma.productVariantEdit.create({ data: { catalogItemId, action: "DROPI", detail: `Organizó las variantes como en Dropi: ${log.join("; ")}`, userId: who.userId, userName: who.userName } }),
  ]);
}

// Productos con stock y variantes que todavía no se organizan como en Dropi (Inicio de DANIEL).
export async function getVariantsToOrganize(): Promise<{ id: string; name: string; justCode: string | null }[]> {
  const withVariants = await prisma.productVariant.findMany({ distinct: ["catalogItemId"], select: { catalogItemId: true } });
  const ids = withVariants.map((v) => v.catalogItemId);
  if (ids.length === 0) return [];
  const [items, stock] = await Promise.all([
    prisma.purchaseCatalogItem.findMany({ where: { id: { in: ids }, variantsOrganizedAt: null }, select: { id: true, name: true, justCode: true } }),
    getVariantStock(ids),
  ]);
  const real = (id: string) => (stock.get(id)?.variants ?? []).filter((v) => !KEEP_NAMES.has(v.name.toLowerCase())).length;
  return items.filter((i) => real(i.id) >= 1).sort((a, b) => a.name.localeCompare(b.name));
}
