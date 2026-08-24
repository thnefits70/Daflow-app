import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canViewPayrollRoles, requireAdminSession } from "@/lib/guards";

// Cuenta Produbanco personal del admin, usada solo para recibir la nómina
// de la 2da quincena/fin de mes — a diferencia de CompanyBankAccount, esta
// es confidencial: mismo criterio de acceso que el resto de Rol de pago
// (canViewPayrollRoles), nunca pública.
export async function GET() {
  if (!(await canViewPayrollRoles())) return NextResponse.json(null);

  const account = await prisma.adminPayrollBankAccount.findUnique({ where: { id: "singleton" } });
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
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const account = await prisma.adminPayrollBankAccount.upsert({
    where: { id: "singleton" },
    update: parsed.data,
    create: { id: "singleton", ...parsed.data },
  });
  return NextResponse.json(account);
}
