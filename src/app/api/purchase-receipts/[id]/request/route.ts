import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canManagePurchaseReceipts } from "@/lib/guards";

// Leader proposes an edit or a deletion — takes effect only once the admin
// approves via POST .../approve. Edit and delete share this endpoint since
// they're the same "propose a change" action, distinguished by `action`.
const requestSchema = z.object({
  action: z.enum(["EDIT", "DELETE"]),
  supplierId: z.string().min(1).optional(),
  numeroComprobante: z.string().trim().optional(),
  bankId: z.string().min(1).optional(),
  monto: z.number().positive().optional(),
  fechaPago: z.string().min(1).optional(),
  fileUrl: z.string().min(1).optional(),
  fileName: z.string().min(1).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const receipt = await prisma.purchaseReceipt.findUnique({ where: { id } });
  if (!receipt) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (!(await canManagePurchaseReceipts(receipt.deptId))) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }
  const data = parsed.data;
  if (data.action === "EDIT" && !data.supplierId) {
    return NextResponse.json({ error: "Elige o crea un proveedor." }, { status: 400 });
  }

  const existing = await prisma.purchaseReceiptChangeRequest.findUnique({ where: { receiptId: id } });
  if (existing) {
    return NextResponse.json({ error: "Ya hay una solicitud pendiente para este comprobante." }, { status: 409 });
  }

  const session = await auth();
  const requestedById = session?.user.role === "admin" ? null : (session?.user.id ?? null);

  const changeRequest = await prisma.purchaseReceiptChangeRequest.create({
    data: {
      receiptId: id,
      action: data.action,
      requestedById,
      ...(data.action === "EDIT"
        ? {
            proposedSupplierId: data.supplierId,
            proposedNumeroComprobante: data.numeroComprobante || null,
            proposedBankId: data.bankId || null,
            proposedMonto: data.monto,
            proposedFechaPago: data.fechaPago ? new Date(data.fechaPago) : undefined,
            proposedFileUrl: data.fileUrl,
            proposedFileName: data.fileName,
          }
        : {}),
    },
  });

  return NextResponse.json(changeRequest, { status: 201 });
}

// Leader (or admin) cancels their own pending request without waiting for
// approve/reject — the receipt is left untouched either way.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const receipt = await prisma.purchaseReceipt.findUnique({ where: { id } });
  if (!receipt) return NextResponse.json({ ok: true });
  if (!(await canManagePurchaseReceipts(receipt.deptId))) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  await prisma.purchaseReceiptChangeRequest.deleteMany({ where: { receiptId: id } });
  return NextResponse.json({ ok: true });
}
