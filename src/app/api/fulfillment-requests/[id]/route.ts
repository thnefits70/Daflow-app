import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canSubmitFulfillmentRequest, canViewFulfillmentRequests } from "@/lib/guards";
import { getCompiledBatch } from "@/lib/rocketRequest";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canViewFulfillmentRequests())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }
  const { id } = await params;
  const batch = await getCompiledBatch(id);
  if (!batch) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  return NextResponse.json(batch);
}

// Confirmado 2026-09-23: si Yair subió un PDF equivocado, puede quitar esa
// subida mientras el corte todavía no se envió a Inventario — sus guías
// quedan libres para volver a subirlas. Una vez enviado, ya no.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canSubmitFulfillmentRequest())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const { id } = await params;
  const batch = await prisma.fulfillmentRequestBatch.findUnique({ where: { id }, select: { lot: { select: { status: true } } } });
  if (!batch) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (batch.lot && batch.lot.status !== "DRAFT") return NextResponse.json({ error: "Este corte ya se envió a Inventario — ya no se puede quitar." }, { status: 409 });
  await prisma.fulfillmentRequestBatch.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
