import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canRetainCancelledGuides, dbUserId } from "@/lib/guards";
import { notifyOwner } from "@/lib/notifications";
import { recomputeAutoFillRate } from "@/lib/autoFillRate";

// Pedido de Daniel 2026-10-14: Daniel o Allan confirman que retuvieron ESTA
// guía (no salió). Le llega aviso a quien la reportó y, si la guía estaba en
// un corte, se recalcula esa semana de Pedidos despachados para que deje de
// sumarla (ver retainedGuideNumbers en autoFillRate.ts).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || !(await canRetainCancelledGuides())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const now = new Date();
  const updated = await prisma.cancelledGuideReport.updateMany({
    where: { id, retainedAt: null },
    data: { retainedAt: now, retainedById: dbUserId(session.user.id) },
  });
  if (updated.count === 0) return NextResponse.json({ error: "Esta guía ya fue marcada como retenida." }, { status: 409 });

  const report = await prisma.cancelledGuideReport.findUnique({
    where: { id },
    select: { code: true, guideNumber: true, submittedById: true, retainedBy: { select: { name: true } } },
  });
  if (!report) return NextResponse.json({ error: "No existe." }, { status: 404 });
  const retainer = report.retainedBy?.name ?? "Administración";

  if (report.submittedById !== session.user.id) {
    await notifyOwner(report.submittedById, {
      title: "✅ Guía retenida",
      body: `${report.code} · Guía ${report.guideNumber} fue retenida por ${retainer}.`,
      url: "/area/workspace?tab=egresos&otab=guias",
    }).catch(() => null);
  }

  const inCut = await prisma.fulfillmentRequestGuide.findMany({
    where: { guideNumber: { equals: report.guideNumber.trim(), mode: "insensitive" } },
    select: { batch: { select: { lot: { select: { day: true } } } } },
  });
  const days = new Set(inCut.map((g) => g.batch.lot?.day).filter((d): d is string => !!d));
  for (const day of days) await recomputeAutoFillRate(day).catch(() => null);

  return NextResponse.json({ ok: true, retainedAt: now.toISOString(), retainedBy: { name: retainer } });
}
