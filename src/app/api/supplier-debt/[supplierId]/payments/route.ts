import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canManageSupplierDebtPayments } from "@/lib/guards";
import { nextSupplierDebtPaymentNumber, formatSupplierDebtPaymentCode } from "@/lib/supplierDebt";

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

  const requests = parsed.data.requestIds.length
    ? await prisma.purchaseRequest.findMany({
        where: { id: { in: parsed.data.requestIds }, supplierId, status: "RECEIVED", debtPaymentId: null },
      })
    : [];
  if (requests.length !== parsed.data.requestIds.length) {
    return NextResponse.json({ error: "Uno o más ítems ya no están disponibles para pagar (revisados o ya incluidos en otra tanda)." }, { status: 409 });
  }

  // Confirmado 2026-09-21: excedente (llegó más de lo pedido) confirmado por
  // Bryan — se paga aparte, anclado a su propio requestId, nunca una
  // solicitud nueva. excessDebtPaymentId null evita pagarlo dos veces.
  const excessReports = parsed.data.excessReportIds.length
    ? await prisma.purchaseRequestUrgentReport.findMany({
        where: {
          id: { in: parsed.data.excessReportIds },
          excessQty: { gt: 0 },
          excessConfirmedAt: { not: null },
          excessDebtPaymentId: null,
          request: { supplierId },
        },
        select: { id: true, excessQty: true, request: { select: { unitCost: true } } },
      })
    : [];
  if (excessReports.length !== parsed.data.excessReportIds.length) {
    return NextResponse.json({ error: "Uno o más excedentes ya no están disponibles para pagar (ya incluidos en otra tanda)." }, { status: 409 });
  }

  const totalAmount =
    requests.reduce((s, r) => s + r.totalCost, 0) +
    excessReports.reduce((s, r) => s + Math.round(r.request.unitCost * r.excessQty * 100) / 100, 0);
  const isAdmin = session.user.role === "admin";

  const number = await nextSupplierDebtPaymentNumber();
  const created = await prisma.supplierDebtPayment.create({
    data: {
      code: formatSupplierDebtPaymentCode(number),
      supplierId,
      totalAmount,
      createdById: isAdmin ? null : session.user.id,
    },
  });
  await Promise.all([
    parsed.data.requestIds.length
      ? prisma.purchaseRequest.updateMany({ where: { id: { in: parsed.data.requestIds } }, data: { debtPaymentId: created.id } })
      : null,
    parsed.data.excessReportIds.length
      ? prisma.purchaseRequestUrgentReport.updateMany({ where: { id: { in: parsed.data.excessReportIds } }, data: { excessDebtPaymentId: created.id } })
      : null,
  ]);

  return NextResponse.json(created);
}
