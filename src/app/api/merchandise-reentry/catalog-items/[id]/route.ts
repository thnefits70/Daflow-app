import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canActOnMerchandiseReentry } from "@/lib/guards";
import { findPurchaseCatalogItemUsage } from "@/lib/purchaseCatalogUsage";

// Confirmado 2026-09-02 (pedido explícito del usuario): borrar de verdad un
// producto del catálogo que un chico de Inventario registró mal antes del
// cierre del 24 de agosto (ver commit beb776f) — cuando Inventario todavía
// podía escribir/matricular productos directo, sin pasar por Compras.
// Exclusivo de Daniel (canActOnMerchandiseReentry — ni siquiera admin, mismo
// criterio que el resto de este módulo, pedido explícito: "ese acceso solo
// debe ser único para Daniel y para nadie más, ni yo"), y solo puede borrar
// productos con ese origen — nunca uno matriculado de verdad por Compras,
// aunque alguien intente forzar el id desde afuera.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canActOnMerchandiseReentry())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const item = await prisma.purchaseCatalogItem.findUnique({
    where: { id },
    select: { id: true, name: true, createdBy: { select: { department: { select: { code: true } } } } },
  });
  if (!item) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (item.createdBy?.department?.code !== "INV") {
    return NextResponse.json({ error: "Solo se pueden eliminar productos registrados por Inventario." }, { status: 403 });
  }

  const usage = await findPurchaseCatalogItemUsage(id);
  if (usage) {
    return NextResponse.json({ error: `Todavía está vinculado en ${usage} — corrígelo ahí primero.` }, { status: 409 });
  }

  await prisma.purchaseCatalogItem.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
