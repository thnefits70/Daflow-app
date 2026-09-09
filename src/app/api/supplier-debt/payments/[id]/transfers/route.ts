import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canManageSupplierDebtPayments } from "@/lib/guards";
import { findDuplicateDebtComprobante } from "@/lib/supplierDebt";

const schema = z.object({
  amount: z.number().positive(),
  transferDate: z.string().min(1),
  bankNameDestino: z.string().trim().min(1),
  accountDestino: z.string().trim().min(1),
  bankNameOrigen: z.string().trim().min(1),
  accountOrigen: z.string().trim().min(1),
  comprobanteNumber: z.string().trim().min(1),
  transactionCost: z.number().nonnegative().optional(),
  iva: z.number().nonnegative().optional(),
  proofUrl: z.string().url(),
});

// Confirmado 2026-09-08 (Fase 1, proveedores con crédito): cada
// transferencia real dentro de una tanda — típicamente varias, hasta cubrir
// el total. No se bloquea un monto fuera del rango típico ($2,000-$4,999):
// es una costumbre operativa del dueño, no una regla que el sistema deba
// imponer.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canManageSupplierDebtPayments()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const payment = await prisma.supplierDebtPayment.findUnique({ where: { id } });
  if (!payment) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (payment.closedAt) return NextResponse.json({ error: "Esta tanda ya está cerrada." }, { status: 409 });

  const dup = await findDuplicateDebtComprobante(parsed.data.comprobanteNumber);
  if (dup) {
    return NextResponse.json({ error: `Ese número de comprobante ya se usó en otra tanda (${dup.debtPaymentCode}) — no se puede reutilizar.` }, { status: 409 });
  }

  const isAdmin = session.user.role === "admin";
  const created = await prisma.supplierDebtTransfer.create({
    data: {
      debtPaymentId: id,
      amount: parsed.data.amount,
      transferDate: new Date(parsed.data.transferDate),
      bankNameDestino: parsed.data.bankNameDestino,
      accountDestino: parsed.data.accountDestino,
      bankNameOrigen: parsed.data.bankNameOrigen,
      accountOrigen: parsed.data.accountOrigen,
      comprobanteNumber: parsed.data.comprobanteNumber,
      transactionCost: parsed.data.transactionCost ?? null,
      iva: parsed.data.iva ?? null,
      proofUrl: parsed.data.proofUrl,
      createdById: isAdmin ? null : session.user.id,
    },
  });

  return NextResponse.json(created);
}
