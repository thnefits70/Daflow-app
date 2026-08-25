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
    // Confirmado 2026-08-18: pedido explícito del usuario — un reporte que
    // subió el equipo de Inventario le llega primero a Daniel; Bryan/admin
    // solo ven lo que él ya revisó (ver urgent-reports/[id]/approve).
    // Confirmado 2026-08-25: un "Reclamo posterior al cierre" (isLateClaim)
    // pasa además por dar de baja en Just antes de poder gestionarse con el
    // proveedor — recién visible acá una vez justConfirmedAt (ver
    // late-claims/[id]/just-confirm). rejectedAt siempre lo excluye.
    where: {
      rejectedAt: null,
      OR: [
        { isLateClaim: false, reviewedByLeadAt: { not: null } },
        { isLateClaim: true, justConfirmedAt: { not: null } },
      ],
    },
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
