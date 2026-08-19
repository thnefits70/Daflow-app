import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canManagePettyCashPrincipal, canManagePettyCashSecundaria } from "@/lib/guards";
import { getOrCreateBox } from "@/lib/pettyCash";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  boxType: z.enum(["PRINCIPAL", "SECUNDARIA"]),
  bankName: z.string().trim().min(1),
  bankAccountType: z.string().trim().min(1),
  bankAccountNumber: z.string().trim().min(1),
  bankAccountHolder: z.string().trim().min(1),
  holderIdType: z.enum(["RUC", "CEDULA"]).optional(),
  holderIdNumber: z.string().trim().optional(),
  email: z.string().trim().email().optional().or(z.literal("")),
  phone: z.string().trim().optional(),
});

// Confirmado 2026-08-19: solo quien de verdad administra la caja día a día
// (nunca admin, que es quien transfiere) puede fijar a qué cuenta quiere
// que se le fondee — así el dueño sabe a dónde transferir sin adivinar.
// Mismos campos que EmployeeBankAccount/SupplierBankAccount, más correo/
// celular opcionales.
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  if (session.user.role === "admin") {
    return NextResponse.json({ error: "Solo quien administra la caja puede fijar su cuenta de destino." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  const { boxType, ...data } = parsed.data;

  const authorized = boxType === "PRINCIPAL" ? await canManagePettyCashPrincipal() : await canManagePettyCashSecundaria();
  if (!authorized) return NextResponse.json({ error: "No autorizado para esta caja." }, { status: 403 });

  const box = await getOrCreateBox(boxType);
  const payoutAccount = await prisma.pettyCashPayoutAccount.upsert({
    where: { boxId: box.id },
    update: {
      bankName: data.bankName, bankAccountType: data.bankAccountType, bankAccountNumber: data.bankAccountNumber,
      bankAccountHolder: data.bankAccountHolder, holderIdType: data.holderIdType ?? null, holderIdNumber: data.holderIdNumber || null,
      email: data.email || null, phone: data.phone || null, updatedById: session.user.id,
    },
    create: {
      boxId: box.id,
      bankName: data.bankName, bankAccountType: data.bankAccountType, bankAccountNumber: data.bankAccountNumber,
      bankAccountHolder: data.bankAccountHolder, holderIdType: data.holderIdType ?? null, holderIdNumber: data.holderIdNumber || null,
      email: data.email || null, phone: data.phone || null, updatedById: session.user.id,
    },
  });

  return NextResponse.json({ ok: true, payoutAccount });
}
