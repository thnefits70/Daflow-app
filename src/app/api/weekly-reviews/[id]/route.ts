import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/guards";

const updateSchema = z.object({
  problem: z.string().trim().min(1).optional(),
  actionPlan: z.string().trim().min(1).optional(),
  status: z.enum(["PENDING", "RESOLVED", "REJECTED"]).optional(),
});

// Confirmado 2026-08-27: revertido — el líder ya NO puede cambiar el
// estado a mano (ver src/lib/weeklyCheckin.ts, MARY_SYSTEM_PROMPT y
// close_previous_report). Un dropdown que el líder controla directo no
// comprueba nada; ahora el único cierre posible es a través de Mary
// (explicando qué hizo de verdad) o del admin editando manualmente acá.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }

  const record = await prisma.weeklyReviewRecord.update({ where: { id }, data: parsed.data }).catch(() => null);
  if (!record) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  return NextResponse.json(record);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }
  const { id } = await params;

  await prisma.weeklyReviewRecord.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
