import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canConfirmPersonalPurchaseFinance } from "@/lib/guards";
import { resolveFirstPayoutMonth } from "@/lib/payroll";
import { addMonthsToMonthStr } from "@/lib/payrollCalc";
import { sendPushToOwner } from "@/lib/webPush";
import { actorName } from "@/lib/actorName";

const schema = z.object({ finalUnitPrice: z.number().positive().optional() });

// Confirmado 2026-08-18: esto es lo que activa el descuento real en el rol
// — no bloquea el retiro (eso ya lo resolvió Daniel antes). Nairoby/admin
// puede ajustar el precio final si corresponde; si no manda nada, queda el
// unitPrice ya calculado al momento de la compra.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canConfirmPersonalPurchaseFinance())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const session = await auth();
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const purchase = await prisma.personalPurchase.findUnique({
    where: { id },
    include: { employee: { select: { id: true, name: true } }, product: { select: { name: true } } },
  });
  if (!purchase) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (purchase.status !== "PENDING_FINANCE") return NextResponse.json({ error: "Todavía no la confirmó bodega, o ya fue procesada." }, { status: 409 });

  const unitPrice = parsed.data.finalUnitPrice ?? purchase.unitPrice;
  const totalAmount = unitPrice * purchase.quantity;

  const naturalFirstMonth = addMonthsToMonthStr(purchase.eventMonth, 1);
  const firstPayoutMonth = await resolveFirstPayoutMonth(naturalFirstMonth);

  const isAdmin = session!.user.role === "admin";
  const updated = await prisma.personalPurchase.update({
    where: { id },
    data: {
      status: "APPROVED",
      unitPrice,
      totalAmount,
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
    body: `${purchase.product.name} — se va a descontar de tu rol a partir de ${firstPayoutMonth}.`,
    url: "/area/compras-personales",
  }).catch(() => null);

  return NextResponse.json(updated);
}
