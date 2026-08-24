import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canApproveMerchandiseReentry, canCloseMerchandiseReentry } from "@/lib/guards";
import { actorName } from "@/lib/actorName";

// Vista de la pestaña "Base de datos de productos" — visible a quien puede
// ver Revisión o Cierre de Reingreso (Daniel/Nairoby/admin), igual que
// Control de Daños. Subir el Excel es más estricto (canManageJustCatalog,
// exclusivo de Daniel) — ver just-catalog/parse y just-catalog/apply.
export async function GET() {
  if (!((await canApproveMerchandiseReentry()) || (await canCloseMerchandiseReentry()))) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const [items, imports] = await Promise.all([
    prisma.purchaseCatalogItem.findMany({
      where: { justCode: { not: null } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, justCode: true, photos: true, pendingRegistration: true },
    }),
    prisma.justCatalogImport.findMany({
      orderBy: { importedAt: "desc" },
      take: 30,
      include: { importedBy: { select: { name: true } } },
    }),
  ]);

  const importsDTO = imports.map((imp) => ({
    id: imp.id,
    importedAt: imp.importedAt,
    importedByName: actorName(imp.importedBy?.name),
    totalRows: imp.totalRows,
    createdCount: imp.createdCount,
    linkedCount: imp.linkedCount,
    renamedCount: imp.renamedCount,
  }));

  return NextResponse.json({
    items,
    lastImport: importsDTO[0] ?? null,
    imports: importsDTO,
  });
}
