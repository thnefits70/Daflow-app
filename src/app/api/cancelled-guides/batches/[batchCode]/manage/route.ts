import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canManageCancelledGuideBatches } from "@/lib/guards";
import { notifyItemAssigneesBatchManaged } from "@/lib/cancelledGuides";

// Bryan confirma que ya gestionó el lote completo con la
// transportadora/Dropi — marca TODAS las guías de ese lote de una.
export async function POST(_req: Request, { params }: { params: Promise<{ batchCode: string }> }) {
  const session = await auth();
  if (!(await canManageCancelledGuideBatches()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { batchCode } = await params;
  const pending = await prisma.cancelledGuideReport.findMany({ where: { batchCode, batchManagedAt: null }, select: { id: true } });
  if (pending.length === 0) return NextResponse.json({ error: "Este lote ya fue gestionado o no existe." }, { status: 409 });

  await prisma.cancelledGuideReport.updateMany({
    where: { id: { in: pending.map((r) => r.id) } },
    data: { batchManagedAt: new Date(), batchManagedById: session.user.id },
  });

  await notifyItemAssigneesBatchManaged(batchCode, pending.length);
  return NextResponse.json({ ok: true, count: pending.length });
}
