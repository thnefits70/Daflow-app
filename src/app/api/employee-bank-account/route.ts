import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// Confirmado 2026-08-20: autoservicio — un colaborador puede registrar
// varias cuentas bancarias, pero solo una queda marcada isSelected a la
// vez; esa es la que se usa para transferir sus anticipos. Sin aprobación
// para registrar ni para cambiar cuál está seleccionada.
export async function GET() {
  const session = await auth();
  if (!session || session.user.role === "admin") return NextResponse.json([]);

  const accounts = await prisma.employeeBankAccount.findMany({
    where: { employeeId: session.user.id },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(accounts);
}

const schema = z.object({
  bankName: z.string().trim().min(1),
  bankAccountType: z.string().trim().min(1),
  bankAccountNumber: z.string().trim().min(1),
  bankAccountHolder: z.string().trim().min(1),
  holderIdType: z.enum(["RUC", "CEDULA"]).optional(),
  holderIdNumber: z.string().trim().optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session || session.user.role === "admin") return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const hasExisting = (await prisma.employeeBankAccount.count({ where: { employeeId: session.user.id } })) > 0;

  const account = await prisma.$transaction(async (tx) => {
    if (hasExisting) {
      await tx.employeeBankAccount.updateMany({ where: { employeeId: session.user.id }, data: { isSelected: false } });
    }
    return tx.employeeBankAccount.create({
      data: { employeeId: session.user.id, ...parsed.data, isSelected: true },
    });
  });
  return NextResponse.json(account, { status: 201 });
}

const selectSchema = z.object({ selectId: z.string().trim().min(1) });

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session || session.user.role === "admin") return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = selectSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const target = await prisma.employeeBankAccount.findUnique({ where: { id: parsed.data.selectId } });
  if (!target || target.employeeId !== session.user.id) return NextResponse.json({ error: "Cuenta no encontrada." }, { status: 404 });

  await prisma.$transaction([
    prisma.employeeBankAccount.updateMany({ where: { employeeId: session.user.id }, data: { isSelected: false } }),
    prisma.employeeBankAccount.update({ where: { id: target.id }, data: { isSelected: true } }),
  ]);
  return NextResponse.json({ ok: true });
}
