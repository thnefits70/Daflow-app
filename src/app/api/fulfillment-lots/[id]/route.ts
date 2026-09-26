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

// Pedido del usuario 2026-09-26: un corte sin productos (subidas quitadas,
// o una subida que quedó en 0 productos) no se podía enviar ni borrar, y el
// de ayer se quedaba arriba "En preparación". Solo se borra si sigue en
// preparación y NINGUNA de sus subidas tiene productos; esas subidas vacías
// se borran con él (sus guías quedan libres para volver a subirlas).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canSubmitFulfillmentRequest())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const { id } = await params;
  const ok = await prisma
    .$transaction(async (tx) => {
      const lot = await tx.fulfillmentLot.findFirst({ where: { id, status: "DRAFT", batches: { none: { items: { some: {} } } } }, select: { id: true } });
      if (!lot) return false;
      await tx.fulfillmentRequestBatch.deleteMany({ where: { lotId: id, items: { none: {} } } });
      // Si justo entró una subida con productos, no se borra nada.
      const { count } = await tx.fulfillmentLot.deleteMany({ where: { id, status: "DRAFT", batches: { none: {} } } });
      if (count === 0) throw new Error("El corte cambió mientras se borraba.");
      return true;
    })
    .catch(() => false);
  if (!ok) return NextResponse.json({ error: "Solo se puede eliminar un corte en preparación y sin productos." }, { status: 409 });
  return NextResponse.json({ ok: true });
}
