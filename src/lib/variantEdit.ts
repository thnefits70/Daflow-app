import { prisma } from "@/lib/prisma";

// Editar la lista de tallas/colores de un producto (pedido del usuario
// 2026-10-15, aprobado por Daniel): lo puede hacer todo el equipo de
// INVESTOCK, siempre (no solo durante el conteo), porque llegan colores
// nuevos o productos que distinguen la talla de otra forma.
// - Nunca cambia el stock total del producto (Kardex), solo cómo se reparte.
// - El nombre viejo queda como alias: las guías, compras y conteos que
//   todavía lo traen caen en la talla correcta.
// - "Sin identificar" no se toca a mano: se arregla en el siguiente conteo.
// Cada cambio queda en ProductVariantEdit (quién, cuándo, qué).

type Who = { userId: string | null; userName: string | null };
type Result = { ok: true } | { ok: false; error: string };

const MAX_NAME = 60;

function cleanName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

async function balance(variantId: string): Promise<number> {
  const r = await prisma.productVariantMovement.aggregate({ where: { variantId }, _sum: { quantity: true } });
  return r._sum.quantity ?? 0;
}

function log(catalogItemId: string, action: string, detail: string, who: Who) {
  return prisma.productVariantEdit.create({ data: { catalogItemId, action, detail, userId: who.userId, userName: who.userName } });
}

export async function addVariant(catalogItemId: string, rawName: string, who: Who): Promise<Result> {
  const name = cleanName(rawName);
  if (!name || name.length > MAX_NAME) return { ok: false, error: "Escribe el nombre de la talla o color." };
  const item = await prisma.purchaseCatalogItem.findUnique({ where: { id: catalogItemId }, select: { id: true } });
  if (!item) return { ok: false, error: "Producto no encontrado." };
  const existing = await prisma.productVariant.findMany({ where: { catalogItemId }, select: { name: true } });
  if (existing.some((e) => e.name.toLowerCase() === name.toLowerCase())) return { ok: false, error: `«${name}» ya está en la lista.` };
  await prisma.$transaction([
    // Si las guías ya traían ese nombre unido a otra talla, desde ahora va a esta.
    prisma.productVariantAlias.deleteMany({ where: { catalogItemId, label: { equals: name, mode: "insensitive" } } }),
    prisma.productVariant.create({ data: { catalogItemId, name } }),
    log(catalogItemId, "ADD", `Agregó «${name}»`, who),
  ]);
  return { ok: true };
}

export async function renameVariant(variantId: string, rawName: string, who: Who): Promise<Result> {
  const name = cleanName(rawName);
  if (!name || name.length > MAX_NAME) return { ok: false, error: "Escribe el nombre nuevo." };
  const v = await prisma.productVariant.findUnique({ where: { id: variantId }, select: { id: true, catalogItemId: true, name: true } });
  if (!v) return { ok: false, error: "Esa talla o color ya no existe. Recarga la página." };
  if (v.name === name) return { ok: true };
  const clash = await prisma.productVariant.findFirst({ where: { catalogItemId: v.catalogItemId, id: { not: v.id }, name: { equals: name, mode: "insensitive" } }, select: { name: true } });
  if (clash) return { ok: false, error: `«${clash.name}» ya existe. Si son la misma, usa «Juntar».` };
  const caseOnly = v.name.toLowerCase() === name.toLowerCase();
  await prisma.$transaction([
    prisma.productVariantAlias.deleteMany({ where: { catalogItemId: v.catalogItemId, label: { equals: name, mode: "insensitive" } } }),
    prisma.productVariant.update({ where: { id: v.id }, data: { name } }),
    // El nombre viejo sigue llevando a esta talla.
    ...(caseOnly
      ? []
      : [
          prisma.productVariantAlias.upsert({
            where: { catalogItemId_label: { catalogItemId: v.catalogItemId, label: v.name } },
            update: { variantId: v.id, ignored: false, decidedById: who.userId, decidedAt: new Date() },
            create: { catalogItemId: v.catalogItemId, label: v.name, variantId: v.id, decidedById: who.userId },
          }),
        ]),
    log(v.catalogItemId, "RENAME", `Cambió «${v.name}» a «${name}»`, who),
  ]);
  return { ok: true };
}

// Junta varias tallas/colores en una sola: sus unidades pasan a la que queda
// y sus nombres quedan como alias de ella.
export async function mergeVariants(targetId: string, sourceIds: string[], who: Who): Promise<Result> {
  const ids = [...new Set(sourceIds)].filter((id) => id !== targetId);
  if (ids.length === 0) return { ok: false, error: "Elige al menos dos tallas o colores para juntar." };
  const target = await prisma.productVariant.findUnique({ where: { id: targetId }, select: { id: true, catalogItemId: true, name: true, countedQty: true } });
  if (!target) return { ok: false, error: "Esa talla o color ya no existe. Recarga la página." };
  const sources = await prisma.productVariant.findMany({ where: { id: { in: ids } }, select: { id: true, catalogItemId: true, name: true, countedQty: true } });
  if (sources.length !== ids.length || sources.some((s) => s.catalogItemId !== target.catalogItemId)) return { ok: false, error: "Alguna talla ya no existe o es de otro producto. Recarga la página." };
  const editRef = `MERGE-${Date.now()}`;
  const ops = [];
  let counted = target.countedQty;
  for (const s of sources) {
    const qty = await balance(s.id);
    if (qty !== 0) ops.push(prisma.productVariantMovement.create({ data: { variantId: target.id, quantity: qty, reason: "MERGE", refId: `${editRef}:${s.id}` } }));
    if (s.countedQty !== null) counted = (counted ?? 0) + s.countedQty;
    ops.push(
      // Lo que las guías ya unían a la talla vieja ahora va a la que queda.
      prisma.productVariantAlias.updateMany({ where: { variantId: s.id }, data: { variantId: target.id } }),
      prisma.productVariantAlias.upsert({
        where: { catalogItemId_label: { catalogItemId: s.catalogItemId, label: s.name } },
        update: { variantId: target.id, ignored: false, decidedById: who.userId, decidedAt: new Date() },
        create: { catalogItemId: s.catalogItemId, label: s.name, variantId: target.id, decidedById: who.userId },
      }),
    );
  }
  ops.push(
    prisma.productVariant.update({ where: { id: target.id }, data: { countedQty: counted } }),
    prisma.productVariant.deleteMany({ where: { id: { in: ids } } }),
    log(target.catalogItemId, "MERGE", `Juntó ${sources.map((s) => `«${s.name}»`).join(", ")} en «${target.name}»`, who),
  );
  await prisma.$transaction(ops);
  return { ok: true };
}

// Solo se quita si no le queda ninguna unidad; si tiene, se junta con otra.
export async function removeVariant(variantId: string, who: Who): Promise<Result> {
  const v = await prisma.productVariant.findUnique({ where: { id: variantId }, select: { id: true, catalogItemId: true, name: true } });
  if (!v) return { ok: false, error: "Esa talla o color ya no existe. Recarga la página." };
  if ((await balance(v.id)) !== 0) return { ok: false, error: `«${v.name}» todavía tiene unidades. Júntala con otra talla en vez de quitarla.` };
  await prisma.$transaction([prisma.productVariant.delete({ where: { id: v.id } }), log(v.catalogItemId, "REMOVE", `Quitó «${v.name}»`, who)]);
  return { ok: true };
}

export type VariantEditProduct = {
  id: string;
  name: string;
  justCode: string | null;
  photo: string | null;
  variants: { id: string; name: string }[];
  history: { detail: string; userName: string | null; at: string }[];
};

// Búsqueda por nombre o ID. Solo nombres: igual que el conteo, nunca se
// muestra cuánto dice el sistema.
export async function searchVariantProducts(q: string): Promise<VariantEditProduct[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const items = await prisma.purchaseCatalogItem.findMany({
    where: { OR: [{ name: { contains: term, mode: "insensitive" } }, { justCode: { contains: term } }] },
    select: { id: true, name: true, justCode: true, photos: true },
    orderBy: { name: "asc" },
    take: 15,
  });
  return withVariants(items);
}

export async function getVariantProduct(catalogItemId: string): Promise<VariantEditProduct | null> {
  const item = await prisma.purchaseCatalogItem.findUnique({ where: { id: catalogItemId }, select: { id: true, name: true, justCode: true, photos: true } });
  return item ? (await withVariants([item]))[0] : null;
}

async function withVariants(items: { id: string; name: string; justCode: string | null; photos: string[] }[]): Promise<VariantEditProduct[]> {
  const ids = items.map((i) => i.id);
  const [variants, edits] = await Promise.all([
    prisma.productVariant.findMany({ where: { catalogItemId: { in: ids } }, select: { id: true, catalogItemId: true, name: true }, orderBy: { name: "asc" } }),
    prisma.productVariantEdit.findMany({ where: { catalogItemId: { in: ids } }, orderBy: { createdAt: "desc" }, take: 100 }),
  ]);
  return items.map((i) => ({
    id: i.id,
    name: i.name,
    justCode: i.justCode,
    photo: i.photos[0] ?? null,
    variants: variants.filter((v) => v.catalogItemId === i.id).map((v) => ({ id: v.id, name: v.name })),
    history: edits.filter((e) => e.catalogItemId === i.id).slice(0, 5).map((e) => ({ detail: e.detail, userName: e.userName, at: e.createdAt.toISOString() })),
  }));
}

// Para Daniel: los últimos cambios de todo el equipo.
export async function recentVariantEdits(limit = 15) {
  const edits = await prisma.productVariantEdit.findMany({ orderBy: { createdAt: "desc" }, take: limit });
  const items = await prisma.purchaseCatalogItem.findMany({ where: { id: { in: [...new Set(edits.map((e) => e.catalogItemId))] } }, select: { id: true, name: true, justCode: true } });
  const by = new Map(items.map((i) => [i.id, i]));
  return edits.map((e) => ({ catalogItemId: e.catalogItemId, product: by.get(e.catalogItemId)?.name ?? "Producto", justCode: by.get(e.catalogItemId)?.justCode ?? null, detail: e.detail, userName: e.userName, at: e.createdAt.toISOString() }));
}

// Los nombres viejos (juntados o renombrados) que todavía llegan en conteos,
// compras o devoluciones caen en la talla que quedó; si dos nombres caen en
// la misma, se suman.
export async function resolveCountsByAlias<T extends { name: string; qty: number }>(catalogItemId: string, counts: T[]): Promise<{ name: string; qty: number }[]> {
  if (counts.length === 0) return [];
  const aliases = await prisma.productVariantAlias.findMany({ where: { catalogItemId, variantId: { not: null } }, select: { label: true, variant: { select: { name: true } } } });
  const map = new Map(aliases.filter((a) => a.variant).map((a) => [a.label.toLowerCase(), a.variant!.name]));
  const out: { name: string; qty: number }[] = [];
  for (const c of counts) {
    const name = map.get(c.name.trim().toLowerCase()) ?? c.name;
    const same = out.find((o) => o.name.toLowerCase() === name.toLowerCase());
    if (same) same.qty += c.qty;
    else out.push({ name, qty: c.qty });
  }
  return out;
}
