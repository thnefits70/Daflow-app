import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canConfirmPersonalPurchaseFinance } from "@/lib/guards";
import { nowInEcuador } from "@/lib/payrollCalc";

// Solo lectura: seguimiento mes a mes de qué se ha cobrado y qué falta de
// cada compra personal con precio ya cerrado (rol o transferencia) —
// pedido explícito del usuario (2026-08-31) para ver, sin entrar orden por
// orden, cómo va fluyendo automáticamente el cobro de cada colaborador
// según lo que eligió en Daflow. Mismo guard y mismo universo de órdenes
// que el Historial (precio cerrado en adelante), pero excluye rechazadas
// porque ahí no hay nada que cobrar.
export async function GET() {
  if (!(await canConfirmPersonalPurchaseFinance())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const orders = await prisma.personalPurchaseOrder.findMany({
    where: { status: { notIn: ["PENDING_INVENTORY", "PENDING_FINANCE", "REJECTED"] } },
    select: {
      id: true,
      status: true,
      totalAmount: true,
      installments: true,
      paymentMethod: true,
      firstPayoutMonth: true,
      financeConfirmedAt: true,
      transferClosedAt: true,
      employee: { select: { name: true } },
      items: { select: { confirmedProductName: true, employeeProductName: true, quantity: true } },
    },
    orderBy: { financeConfirmedAt: "asc" },
  });

  const now = nowInEcuador();
  const currentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return NextResponse.json({ currentMonth, orders });
}
