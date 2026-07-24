import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canManagePurchaseReceipts } from "@/lib/guards";

const updateSchema = z.object({ name: z.string().trim().min(1, "Falta el nombre del banco.") });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bank = await prisma.purchaseReceiptBank.findUnique({ where: { id } });
  if (!bank) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (!(await canManagePurchaseReceipts(bank.deptId))) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }

  const updated = await prisma.purchaseReceiptBank
    .update({ where: { id }, data: { name: parsed.data.name } })
    .catch(() => null);
  if (!updated) return NextResponse.json({ error: "Ya existe otro banco con ese nombre." }, { status: 409 });

  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bank = await prisma.purchaseReceiptBank.findUnique({ where: { id } });
  if (!bank) return NextResponse.json({ ok: true });
  if (!(await canManagePurchaseReceipts(bank.deptId))) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const usageCount = await prisma.purchaseReceipt.count({ where: { bankId: id } });
  if (usageCount > 0) {
    return NextResponse.json(
      { error: "No se puede eliminar: tiene comprobantes guardados con este banco." },
      { status: 409 }
    );
  }

  await prisma.purchaseReceiptBank.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
