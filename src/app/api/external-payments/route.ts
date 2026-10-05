import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canViewPayrollRoles, canEditPayrollRoles } from "@/lib/guards";

// Confirmado 2026-09-09: roster de quien está en modo de pago externo
// (PayrollProfile.externalPaymentMode) para un mes dado, con su
// ExternalPayment de ese mes si ya se registró. Mismo criterio de acceso
// que Roles de pago — Nairoby edita, admin solo lee.
// Ampliado 2026-09-09: pedido explícito del usuario — cada una de esas 8
// personas (Robert, Allan, Bryan, Heidy, Mercedes, Elsa, Joel, Luis
// Castillo) tampoco tenía forma de ver SU PROPIO comprobante de que sí se
// le pagó (a diferencia de quien está en el Rol formal, que ve el suyo en
// MonthlyLegalRolePanel). Quien no puede ver el roster completo (no es
// Nairoby/admin) recibe en cambio su propio historial, sin necesidad de
// mes — mismo patrón "modo propio" que /api/pay-stubs.
export async function GET(req: NextRequest) {
  const canView = await canViewPayrollRoles();
  if (!canView) {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    const payments = await prisma.externalPayment.findMany({
      where: { userId: session.user.id },
      orderBy: { month: "desc" },
    });
    return NextResponse.json({ mode: "own", payments });
  }

  const month = req.nextUrl.searchParams.get("month");
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: "Falta el mes." }, { status: 400 });
  }

  const users = await prisma.user.findMany({
    where: { isActive: true, payrollProfile: { externalPaymentMode: true } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, position: true, startDate: true, payrollProfile: { select: { requiresInvoice: true, externalPaymentModeSince: true } } },
  });
  const payments = await prisma.externalPayment.findMany({ where: { month, userId: { in: users.map((u) => u.id) } } });
  const paymentByUser = new Map(payments.map((p) => [p.userId, p]));

  // Fix confirmado 2026-10-05 (reportado por Nairoby, caso Michelle Ramírez,
  // ingresó 2026-10-04): el roster mostraba "Registrar pago" de septiembre a
  // alguien que todavía no trabajaba acá. Mismo criterio que
  // countMissingExternalPayments en pendingTasks.ts — startDate hasta el fin
  // del mes y externalPaymentModeSince hasta ese mes. Quien ya tenga un pago
  // registrado ese mes se sigue mostrando igual, para no esconderlo.
  const [y, m] = month.split("-").map(Number);
  const monthEnd = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));
  const eligible = users.filter((u) => {
    if (paymentByUser.has(u.id)) return true;
    if (u.startDate && u.startDate > monthEnd) return false;
    const since = u.payrollProfile?.externalPaymentModeSince;
    return !since || month >= since;
  });

  const roster = eligible.map((u) => ({
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
