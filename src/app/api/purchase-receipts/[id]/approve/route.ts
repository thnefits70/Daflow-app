import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/guards";

// Applies the pending change request: EDIT copies the proposed values onto
// the receipt, DELETE removes the receipt outright (cascades the request
// row too). Either way the request row is gone afterward.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const { id } = await params;

  const changeRequest = await prisma.purchaseReceiptChangeRequest.findUnique({ where: { receiptId: id } });
  if (!changeRequest) return NextResponse.json({ error: "No hay ninguna solicitud pendiente." }, { status: 404 });

  if (changeRequest.action === "DELETE") {
    await prisma.purchaseReceipt.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  }

  const updated = await prisma.purchaseReceipt.update({
    where: { id },
    data: {
      ...(changeRequest.proposedSupplierId !== null ? { supplierId: changeRequest.proposedSupplierId } : {}),
      // numeroComprobante/bankId are optional fields — a proposed null is a
      // deliberate "clear it" edit, not "leave unchanged", so both branches
      // of that distinction need to reach the update once the leader's edit
      // form can actually clear them (it always resends both today).
      numeroComprobante: changeRequest.proposedNumeroComprobante,
      bankId: changeRequest.proposedBankId,
      ...(changeRequest.proposedMonto !== null ? { monto: changeRequest.proposedMonto } : {}),
      ...(changeRequest.proposedFechaPago !== null ? { fechaPago: changeRequest.proposedFechaPago } : {}),
      ...(changeRequest.proposedFileUrl !== null ? { fileUrl: changeRequest.proposedFileUrl } : {}),
      ...(changeRequest.proposedFileName !== null ? { fileName: changeRequest.proposedFileName } : {}),
    },
  });
  await prisma.purchaseReceiptChangeRequest.delete({ where: { receiptId: id } });

  return NextResponse.json(updated);
}
