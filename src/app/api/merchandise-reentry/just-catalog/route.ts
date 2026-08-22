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

  const [items, lastImport] = await Promise.all([
    prisma.purchaseCatalogItem.findMany({
      where: { justCode: { not: null } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, justCode: true, photos: true, pendingRegistration: true },
    }),
    prisma.justCatalogImport.findFirst({
      orderBy: { importedAt: "desc" },
      include: { importedBy: { select: { name: true } } },
    }),
  ]);

  return NextResponse.json({
    items,
    lastImport: lastImport
      ? {
          importedAt: lastImport.importedAt,
          importedByName: actorName(lastImport.importedBy?.name),
          totalRows: lastImport.totalRows,
          createdCount: lastImport.createdCount,
          linkedCount: lastImport.linkedCount,
          renamedCount: lastImport.renamedCount,
        }
      : null,
  });
}
