import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canRegisterLunchPayments } from "@/lib/guards";
import { notifyOwner } from "@/lib/notifications";
import { formatLunchMotivo } from "@/lib/lunchPayments";

// 2026-09-26: pedido de Daniel — ya no hace falta confirmar la factura antes
// de enviar (la factura le llega directo a Nairoby, él no la ve). Manda a quien lidera Finanzas (Nairoby), no
// al admin — el admin no debe enterarse de esto todavía.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || !(await canRegisterLunchPayments())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const submission = await prisma.lunchWeekSubmission.findUnique({ where: { id } });
  if (!submission) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (submission.sentToVerificationAt) return NextResponse.json({ error: "Ya fue enviada." }, { status: 409 });

  const updated = await prisma.lunchWeekSubmission.update({
    where: { id },
    data: { sentToVerificationAt: new Date() },
  });

  const finLeader = await prisma.user.findFirst({ where: { isLeader: true, leadsDept: { code: "FIN" } }, select: { id: true } });
  if (finLeader) {
    const motivo = formatLunchMotivo(submission.weekStart.toISOString().slice(0, 10), submission.weekEnd.toISOString().slice(0, 10), submission.lunchCount, submission.monto / submission.lunchCount);
    await notifyOwner(finLeader.id, {
      title: "🍽️ Semana de almuerzos por verificar",
      body: `${motivo} — $${submission.monto.toFixed(2)} · baja la factura del SRI y verifica`,
      url: "/area/workspace",
    }).catch(() => null);
  }

  return NextResponse.json(updated);
}
