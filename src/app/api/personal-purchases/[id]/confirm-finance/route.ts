import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canConfirmPersonalPurchaseFinance } from "@/lib/guards";
import { resolveFirstPayoutMonth } from "@/lib/payroll";
import { addMonthsToMonthStr } from "@/lib/payrollCalc";
import { sendPushToOwner } from "@/lib/webPush";
import { actorName } from "@/lib/actorName";

const schema = z.object({ unitPrice: z.number().positive(), installments: z.number().int().min(1).max(2) });

// Confirmado 2026-08-18: ajustado el mismo día — Nairoby/admin es quien
// DIGITA el precio en dólares acá, nunca antes. El colaborador solo
// declaró el modo (costo/Dropi); esto es lo que activa el descuento real
// en el rol. No bloquea el retiro (eso ya lo resolvió Daniel antes).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canConfirmPersonalPurchaseFinance())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const session = await auth();
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const purchase = await prisma.personalPurchase.findUnique({
    where: { id },
    include: { employee: { select: { id: true, name: true } }, product: { select: { name: true } } },
  });
  if (!purchase) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (purchase.status !== "PENDING_FINANCE") return NextResponse.json({ error: "Todavía no la confirmó bodega, o ya fue procesada." }, { status: 409 });

  const totalAmount = parsed.data.unitPrice * purchase.quantity;
  if (parsed.data.installments === 2 && totalAmount < 25) {
    return NextResponse.json({ error: "Solo se puede pagar en 2 cuotas si el total es de $25 o más." }, { status: 400 });
  }

  const naturalFirstMonth = addMonthsToMonthStr(purchase.eventMonth, 1);
  const firstPayoutMonth = await resolveFirstPayoutMonth(naturalFirstMonth);

  const isAdmin = session!.user.role === "admin";
  const updated = await prisma.personalPurchase.update({
    where: { id },
    data: {
      status: "APPROVED",
      unitPrice: parsed.data.unitPrice,
      totalAmount,
      installments: parsed.data.installments,
      firstPayoutMonth,
      financeConfirmedAt: new Date(),
      financeConfirmedById: isAdmin ? null : session!.user.id,
    },
  });

  const invLeader = await prisma.user.findFirst({ where: { isLeader: true, leadsDept: { code: "INV" } }, select: { id: true } });
  if (invLeader) {
    await sendPushToOwner(invLeader.id, {
      title: "✅ Compra personal cerrada por finanzas",
      body: `${purchase.employee.name} · ${purchase.product.name} · confirmado por ${actorName(isAdmin ? null : session!.user.name)}`,
      url: "/area/compras-personales-inventario",
    }).catch(() => null);
  }
  await sendPushToOwner(purchase.employee.id, {
    title: "✅ Tu compra personal quedó lista",
    body: `${purchase.product.name} — $${totalAmount.toFixed(2)}, se va a descontar de tu rol a partir de ${firstPayoutMonth}.`,
    url: "/area/compras-personales",
  }).catch(() => null);

  return NextResponse.json(updated);
}
