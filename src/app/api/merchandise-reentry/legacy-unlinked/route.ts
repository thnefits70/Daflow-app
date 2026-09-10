import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/guards";

// Confirmado 2026-09-10 (pedido explícito del usuario): antes del
// 2026-08-29, ProductMatchPicker permitía escribir el nombre del producto a
// mano sin conectarlo al catálogo real (ver justCatalog.ts). Esos items
// quedaron con catalogItemId null para siempre — desde esa fecha es
// estructuralmente imposible crear uno nuevo así, así que esta lista es
// exactamente el set de huérfanos históricos, sin necesidad de filtrar por
// fecha. Exclusivo de admin: son items ya aprobados por Daniel, y el resto
// del sistema tiene la regla de que un vínculo ya aprobado nunca se toca
// (ver relink/route.ts) — esta es una excepción puntual solo para vincular
// POR PRIMERA VEZ algo que nunca tuvo vínculo, nunca para cambiar uno que ya
// existe.
export async function GET() {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const items = await prisma.merchandiseReentryItem.findMany({
    where: { catalogItemId: null },
    include: { batch: { select: { code: true } } },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(
    items.map((i) => ({
      id: i.id,
      name: i.correctedName ?? i.declaredName ?? "Producto sin nombre",
      batchCode: i.batch.code,
      createdAt: i.createdAt,
      goodQty: i.goodQty,
      damagedQty: i.damagedQty,
      photoUrl: i.photoUrls[0] ?? null,
    }))
  );
}
