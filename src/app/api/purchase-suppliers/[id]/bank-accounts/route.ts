import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canSubmitPurchaseRequests } from "@/lib/guards";
import { notifyOwner } from "@/lib/notifications";

const createSchema = z.object({
  bankName: z.string().trim().min(1, "Falta el banco."),
  bankAccountType: z.string().trim().min(1, "Falta el tipo de cuenta."),
  bankAccountNumber: z.string().trim().min(1, "Falta el número de cuenta."),
  bankAccountHolder: z.string().trim().min(1, "Falta el titular de la cuenta."),
  holderIdType: z.enum(["RUC", "CEDULA"]),
  holderIdNumber: z.string().trim().min(1, "Falta el número de RUC o cédula."),
});

// Confirmado 2026-08-03: cualquiera con acceso a solicitar compras puede
// agregar una cuenta bancaria nueva a un proveedor ya existente (ej. el
// proveedor cambió de banco, o pide que se le pague en una cuenta distinta)
// — nunca se edita ni se reemplaza una cuenta ya registrada, solo se suma.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canSubmitPurchaseRequests()) || !session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }

  const supplier = await prisma.supplier.findUnique({ where: { id } });
  if (!supplier) return NextResponse.json({ error: "Proveedor no encontrado." }, { status: 404 });

  const isAdmin = session.user.role === "admin";
  const account = await prisma.supplierBankAccount.create({
    data: {
      supplierId: id,
      bankName: parsed.data.bankName,
      bankAccountType: parsed.data.bankAccountType,
      bankAccountNumber: parsed.data.bankAccountNumber,
      bankAccountHolder: parsed.data.bankAccountHolder,
      holderIdType: parsed.data.holderIdType,
      holderIdNumber: parsed.data.holderIdNumber,
      createdById: isAdmin ? null : session.user.id,
      // Confirmado 2026-09-23, revisión anti-fraude: si no la agrega el
      // admin, queda por verificar — no se le puede transferir hasta que el
      // admin confirme con el proveedor que la cuenta es suya.
      verifiedAt: isAdmin ? new Date() : null,
    },
  });
  if (!isAdmin) {
    await notifyOwner("admin", {
      title: "🏦 Cuenta bancaria nueva por verificar",
      body: `${supplier.name} — titular ${account.bankAccountHolder}, ${account.bankName} …${account.bankAccountNumber.slice(-4)}. La agregó ${session.user.name ?? "alguien de Compras"}. Confírmala con el proveedor antes de pagarle.`,
      url: "/admin/proveedores",
    }).catch(() => null);
  }
  return NextResponse.json(account, { status: 201 });
}
