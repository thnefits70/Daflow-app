import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// Confirmado 2026-08-18: autoservicio — cada colaborador registra/edita su
// propia cuenta bancaria, una sola vez, reutilizable para todos sus
// anticipos futuros. Sin aprobación para registrarla.
export async function GET() {
  const session = await auth();
  if (!session || session.user.role === "admin") return NextResponse.json(null);

  const account = await prisma.employeeBankAccount.findUnique({ where: { employeeId: session.user.id } });
  return NextResponse.json(account);
}

const schema = z.object({
  bankName: z.string().trim().min(1),
  bankAccountType: z.string().trim().min(1),
  bankAccountNumber: z.string().trim().min(1),
  bankAccountHolder: z.string().trim().min(1),
  holderIdType: z.enum(["RUC", "CEDULA"]).optional(),
  holderIdNumber: z.string().trim().optional(),
});

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session || session.user.role === "admin") return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const account = await prisma.employeeBankAccount.upsert({
    where: { employeeId: session.user.id },
    update: parsed.data,
    create: { employeeId: session.user.id, ...parsed.data },
  });
  return NextResponse.json(account);
}
