import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canViewPayrollRoles, canEditPayrollRoles } from "@/lib/guards";

// Confirmado 2026-09-09: roster de quien está en modo de pago externo
// (PayrollProfile.externalPaymentMode) para un mes dado, con su
// ExternalPayment de ese mes si ya se registró. Mismo criterio de acceso
// que Roles de pago — Nairoby edita, admin solo lee.
export async function GET(req: NextRequest) {
  if (!(await canViewPayrollRoles())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const month = req.nextUrl.searchParams.get("month");
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: "Falta el mes." }, { status: 400 });
  }

  const users = await prisma.user.findMany({
    where: { isActive: true, payrollProfile: { externalPaymentMode: true } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, position: true, payrollProfile: { select: { requiresInvoice: true } } },
  });
  const payments = await prisma.externalPayment.findMany({ where: { month, userId: { in: users.map((u) => u.id) } } });
  const paymentByUser = new Map(payments.map((p) => [p.userId, p]));

  const roster = users.map((u) => ({
    user: { id: u.id, name: u.name, position: u.position },
    requiresInvoice: u.payrollProfile?.requiresInvoice ?? false,
    payment: paymentByUser.get(u.id) ?? null,
  }));

  return NextResponse.json({ roster });
}

const upsertSchema = z.object({
  userId: z.string().min(1),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  amount: z.number().positive(),
  receiptUrl: z.string().min(1),
  receiptFileName: z.string().min(1),
  invoiceUrl: z.string().min(1).nullable().optional(),
  invoiceFileName: z.string().min(1).nullable().optional(),
  invoiceNumber: z.string().trim().min(1).nullable().optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!(await canEditPayrollRoles())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }
  const { userId, month, amount, receiptUrl, receiptFileName, invoiceUrl, invoiceFileName, invoiceNumber } = parsed.data;

  const profile = await prisma.payrollProfile.findUnique({ where: { userId }, select: { externalPaymentMode: true, requiresInvoice: true } });
  if (!profile?.externalPaymentMode) {
    return NextResponse.json({ error: "Esta persona no está en modo de pago externo." }, { status: 400 });
  }
  if (profile.requiresInvoice && !invoiceUrl) {
    return NextResponse.json({ error: "Esta persona entrega factura — falta subirla." }, { status: 400 });
  }

  const payment = await prisma.externalPayment.upsert({
    where: { userId_month: { userId, month } },
    create: {
      userId,
      month,
      amount,
      receiptUrl,
      receiptFileName,
      invoiceUrl: invoiceUrl ?? null,
      invoiceFileName: invoiceFileName ?? null,
      invoiceNumber: invoiceNumber ?? null,
      registeredById: session!.user.id,
    },
    update: {
      amount,
      receiptUrl,
      receiptFileName,
      invoiceUrl: invoiceUrl ?? null,
      invoiceFileName: invoiceFileName ?? null,
      invoiceNumber: invoiceNumber ?? null,
      registeredById: session!.user.id,
    },
  });

  return NextResponse.json(payment, { status: 201 });
}
