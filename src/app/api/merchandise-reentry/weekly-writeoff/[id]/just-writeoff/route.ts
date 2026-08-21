import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canActOnMerchandiseReentry } from "@/lib/guards";
import { notifyFinanceLeadWeeklyBatchReady } from "@/lib/merchandiseReentry";

// Daniel ya hizo la baja en Just (sistema externo) para todo el acumulado
// de la semana — cierra el corte. Solo se puede una vez pasado el sábado
// de esa semana (sin excepciones, confirmado 2026-08-21): nunca antes.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canActOnMerchandiseReentry()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const batch = await prisma.merchandiseWeeklyWriteOffBatch.findUnique({ where: { id } });
  if (!batch) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (batch.justWrittenOffAt) return NextResponse.json({ error: "Ya estaba marcado como dado de baja." }, { status: 409 });
  if (batch.weekEnd.getTime() >= Date.now()) return NextResponse.json({ error: "Esta semana todavía no termina — el corte es hasta el sábado." }, { status: 409 });

  const updated = await prisma.merchandiseWeeklyWriteOffBatch
    .update({
      where: { id, justWrittenOffAt: null },
      data: { justWrittenOffAt: new Date(), justWrittenOffById: session.user.role === "admin" ? null : session.user.id },
    })
    .catch(() => null);
  if (!updated) return NextResponse.json({ error: "Ya estaba marcado como dado de baja." }, { status: 409 });

  await notifyFinanceLeadWeeklyBatchReady(updated);
  return NextResponse.json(updated);
}
