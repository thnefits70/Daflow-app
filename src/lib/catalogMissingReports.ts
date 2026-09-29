import { prisma } from "@/lib/prisma";
import { notifyOwner } from "@/lib/notifications";

// Confirmado 2026-09-29, pedido del usuario: "Productos que no encontraron"
// se quedaba abierto aunque el producto ya se hubiera creado (ej. "Juego De
// Herramientas 94 Piezas", creado 36 min después del aviso de Yair) porque
// dependía de que alguien apretara "Ya lo agregué". Ahora, cada vez que se
// mira la cola (o el pendiente de Inicio), los avisos cuyo texto coincide
// exacto con el nombre o el ID de un producto que ya existe se cierran solos
// y se le avisa a quien reportó. Lo que no coincide exacto sigue a mano.

// Los "- ALF" son IDs provisionales que nunca se crean en el catálogo (ver
// isProvisionalAlfName en fulfillmentGuides.ts) — confirmado 2026-09-29 con el
// usuario: ni se aceptan como aviso nuevo ni quedan abiertos los viejos.
export const isAlfQuery = (q: string) => /\bALF\s*$/i.test(q.trim());

export async function autoResolveFoundMissingReports(): Promise<void> {
  const open = await prisma.catalogMissingReport.findMany({
    where: { resolvedAt: null },
    select: { id: true, query: true, reportedById: true },
  });
  if (open.length === 0) return;

  const alfIds = open.filter((r) => isAlfQuery(r.query)).map((r) => r.id);
  if (alfIds.length > 0) {
    await prisma.catalogMissingReport.updateMany({ where: { id: { in: alfIds }, resolvedAt: null }, data: { resolvedAt: new Date(), resolvedById: null } });
  }

  for (const r of open) {
    if (alfIds.includes(r.id)) continue;
    const q = r.query.trim().replace(/\s+/g, " ");
    const match = await prisma.purchaseCatalogItem.findFirst({
      where: { OR: [{ name: { equals: q, mode: "insensitive" } }, { justCode: q }] },
      select: { name: true, justCode: true },
    });
    if (!match) continue;

    const closed = await prisma.catalogMissingReport.updateMany({
      where: { id: r.id, resolvedAt: null },
      data: { resolvedAt: new Date(), resolvedById: null },
    });
    if (closed.count > 0 && r.reportedById) {
      await notifyOwner(r.reportedById, {
        title: "✅ Ya está en el catálogo",
        body: `"${match.name}"${match.justCode ? ` (ID ${match.justCode})` : ""} ya existe — ya puedes buscarlo.`,
        url: "/",
      }).catch(() => null);
    }
  }
}
