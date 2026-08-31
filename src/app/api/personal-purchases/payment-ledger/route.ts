import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canConfirmPersonalPurchaseFinance } from "@/lib/guards";
import { nowInEcuador, addMonthsToMonthStr, installmentAmount } from "@/lib/payrollCalc";

type Row = {
  key: string;
  employee: string;
  product: string;
  amount: number;
  detail: string;
  state: "cobrada" | "en-curso" | "pendiente";
};

const NO_MONTH_BUCKET = "sin-mes";

const UNRESOLVED_LABEL: Record<string, string> = {
  PENDING_PAYMENT_METHOD: "Falta que elija cómo paga",
  PENDING_TRANSFER_PROOF: "Eligió transferencia — falta comprobante",
  PENDING_ADMIN_CONFIRM: "Comprobante subido — falta confirmar admin",
  PENDING_NAIROBY_CLOSE: "Transferencia confirmada — falta cerrar",
};

function productLabel(items: { confirmedProductName: string | null; employeeProductName: string; quantity: number }[]) {
  if (items.length > 1) return `${items.length} productos`;
  const it = items[0];
  return it ? `${it.confirmedProductName ?? it.employeeProductName} × ${it.quantity}` : "producto";
}

// Solo lectura: seguimiento mes a mes de qué se ha cobrado y qué falta de
// cada compra personal con precio ya cerrado (rol o transferencia) —
// pedido explícito del usuario (2026-08-31). Corregido el mismo día:
// "cobrada" en la rama de rol ya NO se decide por calendario (asumir que
// el rol de ese mes se pagó) — se cruza contra PayrollQuincenaRole.paidAt,
// el pago individual real confirmado (ver payroll.ts: estos 3 egresos
// automáticos SOLO se aplican en la Q1 del mes, dentro de
// isFirstQuincenaOfMonth). Transferencia ya usaba un hecho real
// (transferClosedAt, lo cierra Nairoby a mano) — esa rama no cambió.
export async function GET() {
  if (!(await canConfirmPersonalPurchaseFinance())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const orders = await prisma.personalPurchaseOrder.findMany({
    where: { status: { notIn: ["PENDING_INVENTORY", "PENDING_FINANCE", "REJECTED"] } },
    select: {
      id: true,
      status: true,
      employeeId: true,
      totalAmount: true,
      installments: true,
      paymentMethod: true,
      firstPayoutMonth: true,
      transferClosedAt: true,
      employee: { select: { name: true } },
      items: { select: { confirmedProductName: true, employeeProductName: true, quantity: true } },
    },
    orderBy: { financeConfirmedAt: "asc" },
  });

  // Q1 exacta que le corresponde a cada cuota de rol de cada orden.
  const payrollOrders = orders.filter((o) => o.paymentMethod === "PAYROLL" && o.firstPayoutMonth && o.totalAmount != null);
  const targetPeriods = new Set<string>();
  for (const o of payrollOrders) {
    for (let i = 0; i < o.installments; i++) targetPeriods.add(`${addMonthsToMonthStr(o.firstPayoutMonth!, i)}-Q1`);
  }
  const employeeIds = [...new Set(payrollOrders.map((o) => o.employeeId))];

  const roles = targetPeriods.size
    ? await prisma.payrollQuincenaRole.findMany({
        where: { isCurrent: true, employeeId: { in: employeeIds }, period: { period: { in: [...targetPeriods] } } },
        select: { employeeId: true, paidAt: true, period: { select: { period: true } } },
      })
    : [];
  const roleByKey = new Map(roles.map((r) => [`${r.employeeId}|${r.period.period}`, r.paidAt]));

  const buckets = new Map<string, Row[]>();
  function push(month: string, row: Row) {
    if (!buckets.has(month)) buckets.set(month, []);
    buckets.get(month)!.push(row);
  }

  for (const o of orders) {
    const employee = o.employee.name;
    const product = productLabel(o.items);

    if (o.paymentMethod === "PAYROLL" && o.firstPayoutMonth && o.totalAmount != null) {
      for (let i = 0; i < o.installments; i++) {
        const month = addMonthsToMonthStr(o.firstPayoutMonth, i);
        const periodStr = `${month}-Q1`;
        const amount = installmentAmount(o.totalAmount, o.installments, i);
        const paidAt = roleByKey.get(`${o.employeeId}|${periodStr}`);
        const state: Row["state"] = paidAt ? "cobrada" : roleByKey.has(`${o.employeeId}|${periodStr}`) ? "en-curso" : "pendiente";
        const cuota = o.installments > 1 ? ` (cuota ${i + 1}/${o.installments})` : "";
        const detail =
          state === "cobrada" ? `Descuento en rol${cuota} — pago confirmado` : state === "en-curso" ? `Descuento en rol${cuota} — rol generado, pago sin confirmar` : `Descuento en rol${cuota} — todavía no se genera ese rol`;
        push(month, { key: `${o.id}-${i}`, employee, product, amount, detail, state });
      }
      continue;
    }

    if (o.paymentMethod === "TRANSFER" && o.transferClosedAt) {
      const month = o.transferClosedAt.toISOString().slice(0, 7);
      push(month, { key: o.id, employee, product, amount: o.totalAmount ?? 0, detail: "Transferencia recibida", state: "cobrada" });
      continue;
    }

    push(NO_MONTH_BUCKET, {
      key: o.id,
      employee,
      product,
      amount: o.totalAmount ?? 0,
      detail: UNRESOLVED_LABEL[o.status] ?? o.status,
      state: "pendiente",
    });
  }

  const now = nowInEcuador();
  const currentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

  const months = [...buckets.keys()].filter((m) => m !== NO_MONTH_BUCKET).sort();
  const allRows = [...buckets.values()].flat();
  const totalCobrado = allRows.filter((r) => r.state === "cobrada").reduce((s, r) => s + r.amount, 0);
  const totalPendiente = allRows.filter((r) => r.state !== "cobrada").reduce((s, r) => s + r.amount, 0);

  return NextResponse.json({
    currentMonth,
    totals: { cobrado: totalCobrado, pendiente: totalPendiente },
    noMonthRows: buckets.get(NO_MONTH_BUCKET) ?? [],
    months: months.map((month) => ({ month, rows: buckets.get(month)! })),
  });
}
