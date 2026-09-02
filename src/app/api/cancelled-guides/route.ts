import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canSubmitCancelledGuide, canViewAllCancelledGuides } from "@/lib/guards";

const REPORT_INCLUDE = {
  submittedBy: { select: { name: true } },
  items: { include: { catalogItem: { select: { name: true, photos: true, justCode: true } } } },
  batchManagedBy: { select: { name: true } },
  itemsAssignedBy: { select: { name: true } },
  reingresadoBy: { select: { name: true } },
} as const;

// Confirmado 2026-08-25: lista propia (asesores de MKT/FUL) o completa
// (líderes de MKT/FUL/INV + admin) — mismo endpoint, filtrado según quién
// pregunta. La creación de guías vive en /api/cancelled-guides/batches
// desde el rediseño 2026-09-02 (ver docblock de CancelledGuideReport).
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const seeAll = await canViewAllCancelledGuides();
  if (!seeAll && !(await canSubmitCancelledGuide())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const reports = await prisma.cancelledGuideReport.findMany({
    where: seeAll ? {} : { submittedById: session.user.id },
    include: REPORT_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(reports);
}
