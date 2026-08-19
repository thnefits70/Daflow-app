import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canConfirmPersonalPurchaseFinance } from "@/lib/guards";
import { resolveFirstPayoutMonth } from "@/lib/payroll";
import { addMonthsToMonthStr } from "@/lib/payrollCalc";
import { sendPushToOwner } from "@/lib/webPush";

const schema = z.object({
  items: z.array(z.object({ itemId: z.string().min(1), costUnitPrice: z.number().nonnegative(), dropiUnitPrice: z.number().nonnegative() })).min(1),
  installments: z.number().int().min(1),
});

// Confirmado 2026-08-18: Nairoby/admin digita el precio en dólares acá —
// sin ningún catálogo, sin ningún valor precargado. Ya se sabe (desde que
// Daniel confirmó) cuántas unidades de cada producto van a costo y cuántas
// a Dropi (unitPriceModes) — con eso se arma el total. Cuotas libres, sin
// tope. Esto es lo que activa el descuento real, y la única vez que el
// colaborador se entera del monto (por push).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canConfirmPersonalPurchaseFinance())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const session = await auth();
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const order = await prisma.personalPurchaseOrder.findUnique({
    where: { id },
    include: { employee: { select: { id: true } }, items: true },
  });
  if (!order) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (order.status !== "PENDING_FINANCE") return NextResponse.json({ error: "Todavía no lo confirmó bodega, o ya fue procesado." }, { status: 409 });

  const priceById = new Map(parsed.data.items.map((i) => [i.itemId, i]));
  for (const it of order.items) {
    if (!priceById.has(it.id)) return NextResponse.json({ error: "Falta fijar el precio de todos los productos." }, { status: 400 });
  }

  let totalAmount = 0;
  for (const it of order.items) {
    const { costUnitPrice, dropiUnitPrice } = priceById.get(it.id)!;
    const modes = (Array.isArray(it.unitPriceModes) ? it.unitPriceModes : []) as string[];
    const costCount = modes.filter((m) => m === "COST").length;
    const dropiCount = modes.filter((m) => m === "DROPI").length;
    const itemTotal = costCount * costUnitPrice + dropiCount * dropiUnitPrice;
    totalAmount += itemTotal;
    await prisma.personalPurchaseItem.update({ where: { id: it.id }, data: { costUnitPrice, dropiUnitPrice, itemTotal } });
  }

  const naturalFirstMonth = addMonthsToMonthStr(order.eventMonth, 1);
  const firstPayoutMonth = await resolveFirstPayoutMonth(naturalFirstMonth);

  const isAdmin = session!.user.role === "admin";
  const updated = await prisma.personalPurchaseOrder.update({
    where: { id },
    data: {
      status: "APPROVED",
      totalAmount,
      installments: parsed.data.installments,
      firstPayoutMonth,
      financeConfirmedAt: new Date(),
      financeConfirmedById: isAdmin ? null : session!.user.id,
    },
  });

  const cuotaText = parsed.data.installments > 1 ? ` en ${parsed.data.installments} cuotas` : "";
  await sendPushToOwner(order.employee.id, {
    title: "✅ Tu compra personal quedó lista",
    body: `Total $${totalAmount.toFixed(2)}${cuotaText} — se va a descontar de tu rol a partir de ${firstPayoutMonth}.`,
    url: "/area/compras-personales",
  }).catch(() => null);

  return NextResponse.json(updated);
}
