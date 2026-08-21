import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canActOnMerchandiseReentry } from "@/lib/guards";
import { maybeMarkBatchApproved } from "@/lib/merchandiseReentry";

const schema = z.object({ confirmed: z.boolean() });

// Daniel verifica físicamente si de verdad está dañado. confirmed=true dará
// pie después a que Nairoby lo registre como baja (write-off route).
// confirmed=false significa que en realidad está bueno — esas unidades se
// suman a goodQty y siguen el camino normal hacia Just, damagedQty se pone
// en 0 (ya no hay nada que dar de baja).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canActOnMerchandiseReentry()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const item = await prisma.merchandiseReentryItem.findUnique({ where: { id }, include: { batch: { select: { submittedAt: true } } } });
  if (!item) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (!item.batch.submittedAt) return NextResponse.json({ error: "Este lote todavía no fue enviado." }, { status: 409 });
  if (item.damagedQty <= 0) return NextResponse.json({ error: "Este producto no tiene unidades dañadas declaradas." }, { status: 409 });

  const actorId = session.user.id;
  // La pregunta del daño ya queda resuelta con esta respuesta sea cual sea
  // — lo único que puede seguir faltando para aprobar el item es el nombre.
  const nameStillMissing = !item.aiRecognized && !item.correctedName;

  const updated = await prisma.merchandiseReentryItem.update({
    where: { id },
    data: {
      damageConfirmed: parsed.data.confirmed,
      damageConfirmedAt: new Date(),
      damageConfirmedById: actorId,
      ...(parsed.data.confirmed ? {} : { goodQty: item.goodQty + item.damagedQty, damagedQty: 0 }),
      ...(nameStillMissing ? {} : { approvedAt: item.approvedAt ?? new Date(), approvedById: item.approvedById ?? actorId }),
    },
  });

  await maybeMarkBatchApproved(item.batchId);
  return NextResponse.json(updated);
}
