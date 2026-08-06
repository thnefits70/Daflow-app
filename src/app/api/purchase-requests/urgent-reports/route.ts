import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canSubmitPurchaseRequests } from "@/lib/guards";
import { isWithinCreditClaimWindow, creditClaimDeadline } from "@/lib/purchaseUrgent";

// Admin, o quien tenga delegación de Compras (hoy Bryan) — es quien coordina
// con el proveedor y elige cómo se resuelve cada reporte de Daniel.
export async function GET(_req: NextRequest) {
  const session = await auth();
  const isAdmin = session?.user.role === "admin";
  if (!session || (!isAdmin && !(await canSubmitPurchaseRequests()))) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const reports = await prisma.purchaseRequestUrgentReport.findMany({
    orderBy: { reportedAt: "desc" },
    include: {
      reportedBy: { select: { name: true } },
      resolutions: {
        orderBy: { createdAt: "asc" },
        include: {
          credit: true,
          replacementVerifiedBy: { select: { name: true } },
          bankConfirmedBy: { select: { name: true } },
        },
      },
      request: {
        select: {
          quantity: true,
          unitCost: true,
          totalCost: true,
          paidAt: true,
          catalogItem: { select: { name: true } },
          supplier: { select: { id: true, name: true } },
        },
      },
    },
  });

  const withDeadline = reports.map((r) => ({
    ...r,
    withinCreditWindow: r.request.paidAt ? isWithinCreditClaimWindow(r.request.paidAt) : true,
    creditClaimDeadline: r.request.paidAt ? creditClaimDeadline(r.request.paidAt).toISOString() : null,
  }));

  return NextResponse.json(withDeadline);
}
