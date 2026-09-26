import { NextRequest, NextResponse } from "next/server";
import { canConfirmFulfillmentLot, canPickFulfillmentLot, canPrintFulfillmentManifest, canSubmitFulfillmentRequest, canViewFulfillmentRequests } from "@/lib/guards";
import { getCompiledLot } from "@/lib/fulfillmentGuides";
import { prisma } from "@/lib/prisma";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canViewFulfillmentRequests())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const { id } = await params;
  const lot = await getCompiledLot(id);
  if (!lot) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  // Qué puede hacer quien mira — así la pantalla no necesita recibir
  // permisos nuevos desde arriba.
  return NextResponse.json({ ...lot, viewer: { canPrint: await canPrintFulfillmentManifest(), canPick: await canPickFulfillmentLot(), canConfirm: await canConfirmFulfillmentLot() } });
}

// Pedido del usuario 2026-09-26: un corte que quedó vacío (se quitaron
// todas sus subidas) no se podía enviar ni borrar, y el de ayer se quedaba
// arriba "En preparación". Solo se borra si sigue en preparación y sin
// ninguna subida — la condición va en el mismo borrado para que una subida
// que entra justo en ese momento no se pierda.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canSubmitFulfillmentRequest())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const { id } = await params;
  const { count } = await prisma.fulfillmentLot.deleteMany({ where: { id, status: "DRAFT", batches: { none: {} } } });
  if (count === 0) return NextResponse.json({ error: "Solo se puede eliminar un corte en preparación y sin subidas." }, { status: 409 });
  return NextResponse.json({ ok: true });
}
