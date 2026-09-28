import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

const schema = z.object({ bodega: z.enum(["MKT_DAMIAN", "MKT_PROVEDIX", "MKT_SHANGHAI", "MKT_SUMINISTROS"]).nullable() });

// Confirmado 2026-09-16, pedido explícito del usuario: marcar a qué marca
// pertenece cada combo de Dropi — mismo criterio y mismo permiso que
// PurchaseCatalogItem's bodega (ver catalog-items/[id]/bodega), elegida
// directamente sobre el combo, independiente de la marca de sus
// componentes.
// Desde 2026-09-28 (pedido del usuario): solo el admin. La marca de un combo
// la aprende la app del manifiesto en que viene (lib/manifestBrand.ts); esto
// queda solo para que el admin corrija.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (session?.user.role !== "admin") return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }

  const combo = await prisma.dropiCombo.findUnique({ where: { id }, select: { id: true } });
  if (!combo) return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  const updated = await prisma.dropiCombo.update({
    where: { id },
    data: { bodega: parsed.data.bodega },
    select: { id: true, bodega: true },
  });
  return NextResponse.json(updated);
}
