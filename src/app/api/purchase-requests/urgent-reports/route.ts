import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canSubmitPurchaseRequests, canConfirmPurchaseReceiving } from "@/lib/guards";
import { isWithinCreditClaimWindow, creditClaimDeadline } from "@/lib/purchaseUrgent";
import { autoWriteOffApprovedLateClaims } from "@/lib/inventoryAutoFlows";

// Admin, o quien tenga delegación de Compras (hoy Bryan), coordina con el
// proveedor y elige cómo se resuelve cada reporte de Daniel — acciones
// propias, gateadas aparte en cada endpoint (resolutions/refund-proof/
// confirm-bank). Confirmado 2026-09-01: pedido explícito del usuario —
// Daniel y su equipo de Inventario (canConfirmPurchaseReceiving) ahora
// también pueden VER esta bandeja en solo lectura desde su pestaña "Reportes
// urgentes" (antes no existía para ellos), para no perder de vista lo que
// falta por llegarles aunque no puedan coordinar nada ellos mismos.
export async function GET(_req: NextRequest) {
  const session = await auth();
  const isAdmin = session?.user.role === "admin";
  if (!session || (!isAdmin && !(await canSubmitPurchaseRequests()) && !(await canConfirmPurchaseReceiving()))) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  // Cualquier reclamo posterior ya aprobado que siguiera esperando la vieja
  // "baja en Just" se descuenta de INVESTOCK y se libera acá mismo.
  await autoWriteOffApprovedLateClaims().catch(() => 0);

  const reports = await prisma.purchaseRequestUrgentReport.findMany({
    // Confirmado 2026-08-18: pedido explícito del usuario — un reporte que
    // subió el equipo de Inventario le llega primero a Daniel; Bryan/admin
    // solo ven lo que él ya revisó (ver urgent-reports/[id]/approve).
    // Un "Reclamo posterior al cierre" (isLateClaim) es visible acá una vez
    // justConfirmedAt — que desde 2026-09-23 se marca solo al aprobarlo,
    // junto con la salida de INVESTOCK (ver inventoryAutoFlows.ts).
    // rejectedAt siempre lo excluye.
    where: {
      rejectedAt: null,
      OR: [
        {
          // Confirmado 2026-09-08: pedido explícito de Daniel — un reporte
          // que él mismo resolvió internamente con su equipo (sin
          // escalarlo) nunca debe aparecer en la bandeja de Compras, aunque
          // reviewedByLeadAt ya esté marcado (ver
          // urgent-reports/[id]/resolve-internal/route.ts).
          resolvedInternallyAt: null,
          OR: [
            { isLateClaim: false, reviewedByLeadAt: { not: null } },
            { isLateClaim: true, justConfirmedAt: { not: null } },
          ],
        },
        // Fix 2026-09-19: bug real — resolve-internal solo revisa
        // dañado/incompleto/diferente antes de cerrar, nunca excessQty. Un
        // reporte de solo excedente (todo lo demás en 0) quedaba marcado
        // resolvedInternallyAt y desaparecía de esta bandeja para siempre,
        // sin que Jariel pudiera gestionar esas unidades de más con el
        // proveedor. El excedente sigue su propio camino
        // (excessGestion/excessConfirm/excessKardex), independiente de si
        // el reclamo de dañado/faltante ya se resolvió internamente.
        { excessQty: { gt: 0 }, excessKardexRecordedAt: null },
      ],
    },
    orderBy: { reportedAt: "desc" },
    include: {
      reportedBy: { select: { name: true } },
      excessGestionBy: { select: { name: true } },
      excessConfirmedBy: { select: { name: true } },
      resolutions: {
        orderBy: { createdAt: "asc" },
        include: {
          credit: true,
          replacementVerifiedBy: { select: { name: true } },
          bankConfirmedBy: { select: { name: true } },
          createdBy: { select: { name: true } },
          cancelledBy: { select: { name: true } },
        },
      },
      request: {
        select: {
          quantity: true,
          unitCost: true,
          totalCost: true,
          paidAt: true,
          catalogItem: { select: { name: true, justCode: true } },
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
