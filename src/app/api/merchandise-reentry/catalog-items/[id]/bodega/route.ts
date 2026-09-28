import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

const schema = z.object({ bodega: z.enum(["MKT_DAMIAN", "MKT_PROVEDIX", "MKT_SHANGHAI", "MKT_SUMINISTROS"]).nullable() });

// Confirmado 2026-09-16, pedido explícito del usuario: marcar a qué marca
// (Provedix/Importadora Damián/Importadora Shanghai) pertenece cada
// producto del catálogo — editable solo desde "Stock Actual", mismo
// permiso que ya controla esa pantalla (canManageJustCatalog: Daniel o
// admin), no desde "Base de datos de productos".
// Desde 2026-09-28 (pedido del usuario): solo el admin. La marca ya viene de
// Análisis de Mercado o de Control de Compras al crear el producto; Daniel
// ya no la pone. Esto queda solo para que el admin corrija un error.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (session?.user.role !== "admin") return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }

  const item = await prisma.purchaseCatalogItem.findUnique({ where: { id }, select: { id: true } });
  if (!item) return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  const updated = await prisma.purchaseCatalogItem.update({
    where: { id },
    data: { bodega: parsed.data.bodega },
    select: { id: true, bodega: true },
  });
  return NextResponse.json(updated);
}
