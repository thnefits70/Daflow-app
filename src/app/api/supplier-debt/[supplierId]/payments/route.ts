import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canManageSupplierDebtPayments } from "@/lib/guards";
import {
  nextSupplierDebtPaymentNumber,
  formatSupplierDebtPaymentCode,
  getSupplierDebtPendingItems,
  getSupplierDebtPendingExcessItems,
  tandaCreditMarker,
} from "@/lib/supplierDebt";

const schema = z
  .object({ requestIds: z.array(z.string()).default([]), excessReportIds: z.array(z.string()).default([]) })
  .refine((d) => d.requestIds.length + d.excessReportIds.length > 0, { message: "Elige al menos un ítem." });

// Confirmado 2026-09-08 (Fase 1, proveedores con crédito): el admin arma una
// tanda eligiendo cuáles de los ítems pendientes (ya RECEIVED, sin pagar)
// entran a pagarse juntos — esto FIJA esos ítems a la tanda (debtPaymentId),
// el total se calcula una sola vez acá y no se recalcula después aunque el
// historial cambie. El pago real (las transferencias) se agrega después.
export async function POST(req: NextRequest, { params }: { params: Promise<{ supplierId: string }> }) {
  const session = await auth();
  if (!(await canManageSupplierDebtPayments()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { supplierId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
  if (!supplier) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (supplier.paymentMode !== "CREDITO") return NextResponse.json({ error: "Este proveedor no es de crédito." }, { status: 409 });

  // Confirmado 2026-09-22, pedido explícito del usuario (evitar pagar doble
  // o pagar lo que llegó mal): la tanda solo acepta ítems que HOY son
  // pagables según exactamente la misma regla que ve el panel —
  // getSupplierDebtPendingItems (RECEIVED, sin tanda, confirmado por Bryan,
  // sin ningún reporte abierto de dañado/incompleto/distinto) y
  // getSupplierDebtPendingExcessItems. El monto de cada pedido ya viene neto
  // de descuentos aceptados por el proveedor (creditDeduction).
  const [payableItems, payableExcess] = await Promise.all([
    getSupplierDebtPendingItems(supplierId),
    getSupplierDebtPendingExcessItems(supplierId),
  ]);
  const payableById = new Map(payableItems.map((i) => [i.id, i]));
  const excessById = new Map(payableExcess.map((i) => [i.id, i]));
  const requests = parsed.data.requestIds.map((id) => payableById.get(id));
  if (requests.some((r) => !r)) {
    return NextResponse.json(
      { error: "Uno o más ítems ya no se pueden pagar (siguen en los 7 días de revisión de bodega, tienen un reporte abierto de mercadería dañada/incompleta, o ya están en otra tanda)." },
      { status: 409 }
    );
  }
  const excessReports = parsed.data.excessReportIds.map((id) => excessById.get(id));
  if (excessReports.some((r) => !r)) {
    return NextResponse.json({ error: "Uno o más excedentes ya no están disponibles para pagar (siguen en los 7 días de revisión de bodega, o ya están en otra tanda)." }, { status: 409 });
  }
  const okRequests = requests.filter((r): r is NonNullable<typeof r> => !!r);
  const okExcess = excessReports.filter((r): r is NonNullable<typeof r> => !!r);
  const creditIds = okRequests.flatMap((r) => r.creditIds);

  const totalAmount =
    Math.round((okRequests.reduce((s, r) => s + r.totalCost, 0) + okExcess.reduce((s, r) => s + r.amount, 0)) * 100) / 100;
  const isAdmin = session.user.role === "admin";

  const number = await nextSupplierDebtPaymentNumber();
  // Todo o nada: cada ítem se "reclama" solo si sigue libre en este mismo
  // instante (debtPaymentId null) — si otra persona armó una tanda con el
  // mismo ítem un segundo antes, el conteo no cuadra y se deshace todo, así
  // un pedido nunca queda en dos tandas.
  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
      const payment = await tx.supplierDebtPayment.create({
        data: {
          code: formatSupplierDebtPaymentCode(number),
          supplierId,
          totalAmount,
          createdById: isAdmin ? null : session.user.id,
        },
      });
      if (parsed.data.requestIds.length) {
        const claimed = await tx.purchaseRequest.updateMany({
          where: { id: { in: parsed.data.requestIds }, supplierId, status: "RECEIVED", debtPaymentId: null },
          data: { debtPaymentId: payment.id },
        });
        if (claimed.count !== parsed.data.requestIds.length) throw new Error("CONFLICT");
      }
      if (parsed.data.excessReportIds.length) {
        const claimed = await tx.purchaseRequestUrgentReport.updateMany({
          where: { id: { in: parsed.data.excessReportIds }, excessDebtPaymentId: null },
          data: { excessDebtPaymentId: payment.id },
        });
        if (claimed.count !== parsed.data.excessReportIds.length) throw new Error("CONFLICT");
      }
      // El descuento que el proveedor aceptó queda usado en ESTA tanda —
      // nunca se vuelve a descontar en otra compra (ver tandaCreditMarker).
      if (creditIds.length) {
        const applied = await tx.supplierCredit.updateMany({
          where: { id: { in: creditIds }, status: "AVAILABLE" },
          data: { status: "APPLIED", appliedToGroupId: tandaCreditMarker(payment.id), appliedAt: new Date() },
        });
        if (applied.count !== creditIds.length) throw new Error("CONFLICT");
      }
      return payment;
    });
  } catch (e) {
    if (e instanceof Error && e.message === "CONFLICT") {
      return NextResponse.json({ error: "Alguien más acaba de incluir uno de estos ítems en otra tanda. Recarga la página y vuelve a intentar." }, { status: 409 });
    }
    throw e;
  }

  return NextResponse.json(created);
}
