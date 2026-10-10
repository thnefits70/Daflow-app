import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { aliasEditMessage, canSetMissingComboBrand, syncComboAliases } from "@/lib/comboAlias";

const schema = z.object({ bodega: z.enum(["MKT_DAMIAN", "MKT_PROVEDIX", "MKT_SHANGHAI", "MKT_SUMINISTROS"]).nullable() });

// Confirmado 2026-09-16, pedido explícito del usuario: marcar a qué marca
// pertenece cada combo de Dropi — mismo criterio y mismo permiso que
// PurchaseCatalogItem's bodega (ver catalog-items/[id]/bodega), elegida
// directamente sobre el combo, independiente de la marca de sus
// componentes.
// Desde 2026-09-28 (pedido del usuario): solo el admin. La marca de un combo
// la aprende la app del manifiesto en que viene (lib/manifestBrand.ts); esto
// queda solo para que el admin corrija.
// Pedido del usuario 2026-10-10: la asesora B2B elige la marca de un combo
// que quedó sin marca (vino en un PDF "SinMarca"); cambiar una marca ya
// puesta sigue siendo solo del admin.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const isAdmin = session?.user.role === "admin";
  if (!isAdmin && !(await canSetMissingComboBrand())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }

  const combo = await prisma.dropiCombo.findUnique({ where: { id }, select: { id: true, code: true, bodega: true, aliasOf: { select: { code: true } } } });
  if (!combo) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (!isAdmin && (combo.bodega || !parsed.data.bodega)) {
    return NextResponse.json({ error: "Este combo ya tiene marca — solo el administrador puede cambiarla." }, { status: 403 });
  }
  // Pedido del usuario 2026-10-10: un ID alterno siempre lleva la marca de su
  // madre; al cambiar la del madre, cambia también la de sus IDs alternos.
  if (combo.aliasOf) return NextResponse.json({ error: aliasEditMessage(combo.code, combo.aliasOf.code) }, { status: 400 });

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.dropiCombo.update({ where: { id }, data: { bodega: parsed.data.bodega }, select: { id: true, bodega: true } });
    await syncComboAliases(tx, id);
    return u;
  });
  return NextResponse.json(updated);
}
