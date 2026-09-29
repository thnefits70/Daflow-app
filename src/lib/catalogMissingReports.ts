import { prisma } from "@/lib/prisma";
import { notifyOwner } from "@/lib/notifications";

// Confirmado 2026-09-29, pedido del usuario: "Productos que no encontraron"
// se quedaba abierto aunque el producto ya se hubiera creado (ej. "Juego De
// Herramientas 94 Piezas", creado 36 min después del aviso de Yair) porque
// dependía de que alguien apretara "Ya lo agregué". Ahora, cada vez que se
// mira la cola (o el pendiente de Inicio), los avisos cuyo texto coincide
// exacto con el nombre o el ID de un producto que ya existe se cierran solos
// y se le avisa a quien reportó. Lo que no coincide exacto sigue a mano.

export async function autoResolveFoundMissingReports(): Promise<void> {
  const open = await prisma.catalogMissingReport.findMany({
    where: { resolvedAt: null },
    select: { id: true, query: true, reportedById: true },
  });
  if (open.length === 0) return;

  for (const r of open) {
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
