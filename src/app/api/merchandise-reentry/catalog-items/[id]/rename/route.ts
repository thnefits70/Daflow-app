import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canManageJustCatalog } from "@/lib/guards";

const schema = z.object({ name: z.string().trim().min(1, "El nombre no puede estar vacío.").max(200) });

// Corrección manual del nombre de un producto del catálogo — pedido
// explícito del usuario 2026-09-02: Daniel no tenía ninguna forma de
// arreglar un nombre mal escrito (ej. "AFEITADORA 2 EN 1") cuando el
// producto vino de la importación oficial de Just (el lápiz de "Revisión"
// solo corrige productos legacy registrados a mano por Inventario, ver
// legacyInventoryName en batches/review/route.ts). Mismo permiso que ya
// controla toda la pestaña "Base de datos de productos" (canManageJustCatalog).
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
    where: { name: parsed.data.name, id: { not: id } },
    select: { id: true },
  });
  if (duplicate) return NextResponse.json({ error: "Ya existe otro producto con ese nombre." }, { status: 409 });

  const updated = await prisma.purchaseCatalogItem.update({
    where: { id },
    data: { name: parsed.data.name },
    select: { id: true, name: true },
  });
  return NextResponse.json(updated);
}
