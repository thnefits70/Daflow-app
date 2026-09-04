import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canSubmitCancelledGuide, canViewAllCancelledGuides, canAssignCancelledGuideItems } from "@/lib/guards";

const REPORT_INCLUDE = {
  submittedBy: { select: { name: true } },
  items: { include: { catalogItem: { select: { name: true, photos: true, justCode: true } } } },
  batchManagedBy: { select: { name: true } },
  fulfillmentRemovedBy: { select: { name: true } },
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

  // Heidy (canAssignCancelledGuideItems) ya ve TODAS las guías pendientes de
  // cargar productos, cruzando departamentos (/api/cancelled-guides/pending-items)
  // — el historial debe reflejar esa misma cobertura, no solo lo que ella
  // reportó, para que pueda seguir el estado de las guías que gestiona.
  const seeAll = (await canViewAllCancelledGuides()) || (await canAssignCancelledGuideItems());
  if (!seeAll && !(await canSubmitCancelledGuide())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const reports = await prisma.cancelledGuideReport.findMany({
    where: seeAll ? {} : { submittedById: session.user.id },
    include: REPORT_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(reports);
}
