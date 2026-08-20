import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { resolveFirstPayoutMonth } from "@/lib/payroll";
import { addMonthsToMonthStr } from "@/lib/payrollCalc";
import { sendPushToOwner } from "@/lib/webPush";

const schema = z.object({ method: z.enum(["PAYROLL", "TRANSFER"]) });

// Confirmado 2026-08-20: recién acá el colaborador elige cómo paga, una vez
// que ya sabe el total. PAYROLL activa el descuento real (mismo cálculo que
// antes hacía confirm-finance) — TRANSFER solo abre la pantalla de subir
// comprobante, sin tocar nómina para nada. firstPayoutMonth SOLO se calcula
// en la rama PAYROLL — es la garantía de que a nadie que pague por
// transferencia le sale además el descuento en rol (payroll.ts filtra por
// firstPayoutMonth not null).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || session.user.role === "admin") return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const order = await prisma.personalPurchaseOrder.findUnique({ where: { id } });
  if (!order) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (order.employeeId !== session.user.id) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  if (order.status !== "PENDING_PAYMENT_METHOD") return NextResponse.json({ error: "Ya fue procesado." }, { status: 409 });

  if (parsed.data.method === "TRANSFER") {
    const updated = await prisma.personalPurchaseOrder.update({
      where: { id },
      data: { paymentMethod: "TRANSFER", status: "PENDING_TRANSFER_PROOF" },
    });
    return NextResponse.json(updated);
  }

  const naturalFirstMonth = addMonthsToMonthStr(order.eventMonth, 1);
  const firstPayoutMonth = await resolveFirstPayoutMonth(naturalFirstMonth);

  const updated = await prisma.personalPurchaseOrder.update({
    where: { id },
    data: { paymentMethod: "PAYROLL", status: "APPROVED", firstPayoutMonth },
  });

  const cuotaText = order.installments > 1 ? ` en ${order.installments} cuotas` : "";
  await sendPushToOwner(session.user.id, {
    title: "✅ Tu compra personal quedó en rol",
    body: `Total $${order.totalAmount?.toFixed(2)}${cuotaText} — se va a descontar de tu rol a partir de ${firstPayoutMonth}.`,
    url: "/area/compras-personales",
  }).catch(() => null);

  return NextResponse.json(updated);
}
