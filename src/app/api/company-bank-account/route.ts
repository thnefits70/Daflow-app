import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/guards";

// Confirmado 2026-08-20: cuenta única de la empresa para recibir
// transferencias de compras personales. Cualquier colaborador autenticado
// puede leerla (la necesita al elegir pagar por transferencia) — solo el
// admin puede editarla, desde Configuración.
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json(null);

  const account = await prisma.companyBankAccount.findUnique({ where: { id: "singleton" } });
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

  const account = await prisma.companyBankAccount.upsert({
    where: { id: "singleton" },
    update: parsed.data,
    create: { id: "singleton", ...parsed.data },
  });
  return NextResponse.json(account);
}
