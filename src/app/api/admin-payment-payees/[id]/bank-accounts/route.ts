import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canManageAdminPayments } from "@/lib/guards";

const schema = z.object({
  bankName: z.string().trim().min(1, "Falta el banco."),
  bankAccountType: z.string().trim().min(1, "Falta el tipo de cuenta."),
  bankAccountNumber: z.string().trim().min(1, "Falta el número de cuenta."),
  bankAccountHolder: z.string().trim().min(1, "Falta el titular de la cuenta."),
  holderIdType: z.enum(["RUC", "CEDULA"]),
  holderIdNumber: z.string().trim().min(1, "Falta el número de RUC o cédula."),
});

// Confirmado 2026-08-06: nunca se edita ni se reemplaza una cuenta ya
// registrada, solo se suma — mismo patrón que proveedores.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || !(await canManageAdminPayments())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const payee = await prisma.adminPaymentPayee.findUnique({ where: { id } });
  if (!payee) return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  const isAdmin = session.user.role === "admin";
  const account = await prisma.adminPaymentPayeeBankAccount.create({
    data: {
      payeeId: id,
      bankName: parsed.data.bankName,
      bankAccountType: parsed.data.bankAccountType,
      bankAccountNumber: parsed.data.bankAccountNumber,
      bankAccountHolder: parsed.data.bankAccountHolder,
      holderIdType: parsed.data.holderIdType,
      holderIdNumber: parsed.data.holderIdNumber,
      createdById: isAdmin ? null : session.user.id,
    },
  });
  return NextResponse.json(account, { status: 201 });
}
