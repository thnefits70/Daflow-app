import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canManageJustCatalog } from "@/lib/guards";

const schema = z.object({ justCode: z.string().trim().min(1, "El código no puede estar vacío.").max(50) });

// Corrección manual del código de Just de un producto ya existente —
// pedido explícito del usuario 2026-09-21: el reporte semanal de Daniel
// trae códigos que ya corresponden a un producto real del catálogo (mismo
// nombre) pero que quedó sin justCode o con uno equivocado, y hasta ahora
// no había forma de arreglarlo salvo re-crear el producto. Mismo permiso
// que ya controla "Base de datos de productos" (canManageJustCatalog),
// igual criterio que rename/route.ts.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canManageJustCatalog())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }

  const item = await prisma.purchaseCatalogItem.findUnique({ where: { id }, select: { id: true } });
  if (!item) return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  const duplicate = await prisma.purchaseCatalogItem.findFirst({
    where: { justCode: parsed.data.justCode, id: { not: id } },
    select: { id: true, name: true },
  });
  if (duplicate) {
    return NextResponse.json({ error: `Ese código ya está asignado a "${duplicate.name}".` }, { status: 409 });
  }

  const updated = await prisma.purchaseCatalogItem.update({
    where: { id },
    data: { justCode: parsed.data.justCode },
    select: { id: true, justCode: true },
  });
  return NextResponse.json(updated);
}
