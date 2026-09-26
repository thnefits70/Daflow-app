import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canActOnMerchandiseOutflow, canCaptureMerchandiseOutflow } from "@/lib/guards";

const MAX_PHOTOS = 20;
// DETERIORO: antes (2026-09-21) era "una sola foto" por reporte. Cambiado
// 2026-09-26, pedido de Daniel — un reporte puede traer varios productos del
// mismo proveedor (ej. mucha mercadería de Chen) y una foto no alcanza; ahora
// usa el mismo máximo (MAX_PHOTOS) que CAMBIO_PROVEEDOR.
const MAX_PHOTOS_BY_REASON: Partial<Record<string, number>> = {};
const schema = z.object({ photoUrls: z.array(z.string().min(1)).max(MAX_PHOTOS) });

// CAMBIO_PROVEEDOR: fotos de la lista física de productos que se están
// declarando para el cambio — a diferencia de batches/[id]/extract (que lee
// un manifiesto con IA para despacho/garantía), acá es solo evidencia, sin
// lectura automática. El cliente reenvía el arreglo completo acumulado cada
// vez (mismo patrón que extract), no un solo agregado.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const tooMany = parsed.error.issues.some((i) => i.path[0] === "photoUrls" && i.code === "too_big");
    return NextResponse.json({ error: tooMany ? `Máximo ${MAX_PHOTOS} fotos por lote.` : "Datos inválidos." }, { status: 400 });
  }

  const batch = await prisma.merchandiseOutflowBatch.findUnique({ where: { id }, select: { createdById: true, submittedAt: true, reason: true } });
  if (!batch) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (batch.reason !== "CAMBIO_PROVEEDOR" && batch.reason !== "DETERIORO") return NextResponse.json({ error: "Este motivo no usa este paso." }, { status: 400 });
  const authorized = batch.reason === "CAMBIO_PROVEEDOR" ? await canActOnMerchandiseOutflow() : await canCaptureMerchandiseOutflow();
  if (!authorized) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  if (batch.createdById !== session.user.id) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  if (batch.submittedAt) return NextResponse.json({ error: "Este lote ya fue enviado." }, { status: 409 });
  const maxForReason = MAX_PHOTOS_BY_REASON[batch.reason] ?? MAX_PHOTOS;
  if (parsed.data.photoUrls.length > maxForReason) {
    return NextResponse.json({ error: `Máximo ${maxForReason} foto(s) para este motivo.` }, { status: 400 });
  }

  const updated = await prisma.merchandiseOutflowBatch.update({ where: { id }, data: { documentPhotoUrls: parsed.data.photoUrls } });
  return NextResponse.json(updated);
}
