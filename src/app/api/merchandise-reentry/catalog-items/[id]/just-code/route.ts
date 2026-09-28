import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { productIdUsedByCombo } from "@/lib/comboBrand";

const schema = z.object({ justCode: z.string().trim().min(1, "El código no puede estar vacío.").max(50) });

// Corrección manual del código de Just de un producto ya existente —
// pedido explícito del usuario 2026-09-21: el reporte semanal de Daniel
// trae códigos que ya corresponden a un producto real del catálogo (mismo
// nombre) pero que quedó sin justCode o con uno equivocado, y hasta ahora
// no había forma de arreglarlo salvo re-crear el producto. Mismo permiso
// que ya controla "Base de datos de productos" (canManageJustCatalog),
// igual criterio que rename/route.ts.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Confirmado 2026-09-28, pedido del usuario: ya ningún producto necesita
  // ID a mano (Compras lo exige, Análisis de Mercado lo trae de Heidy) — el
  // lápiz queda solo para que el admin corrija un ID mal escrito.
  const session = await auth();
  if (session?.user.role !== "admin") return NextResponse.json({ error: "Solo el administrador puede corregir un ID." }, { status: 403 });

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

  const comboClash = await productIdUsedByCombo(parsed.data.justCode);
  if (comboClash) return NextResponse.json({ error: comboClash }, { status: 409 });

  const updated = await prisma.purchaseCatalogItem.update({
    where: { id },
    data: { justCode: parsed.data.justCode },
    select: { id: true, justCode: true },
  });
  return NextResponse.json(updated);
}
