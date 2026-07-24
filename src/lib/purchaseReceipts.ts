import { prisma } from "@/lib/prisma";

export type PurchaseReceiptChangeRequestDTO = {
  action: "EDIT" | "DELETE";
  requestedByName: string | null;
  requestedAt: string;
  proposedProveedor: string | null;
  proposedMonto: number | null;
  proposedFechaPago: string | null;
  proposedFileUrl: string | null;
  proposedFileName: string | null;
};

export type PurchaseReceiptDTO = {
  id: string;
  proveedor: string;
  monto: number;
  fechaPago: string;
  fileUrl: string;
  fileName: string;
  createdByName: string | null;
  createdAt: string;
  changeRequest: PurchaseReceiptChangeRequestDTO | null;
};

// Server-only — Comprobante de pago (Gestión de Compras). Callers gate
// access with canManagePurchaseReceipts(deptId) before showing this data;
// this function itself does no permission checking.
export async function getPurchaseReceipts(deptId: string): Promise<PurchaseReceiptDTO[]> {
  const receipts = await prisma.purchaseReceipt.findMany({
    where: { deptId },
    orderBy: { fechaPago: "desc" },
    include: {
      createdBy: { select: { name: true } },
      changeRequest: { include: { requestedBy: { select: { name: true } } } },
    },
  });

  return receipts.map((r) => ({
    id: r.id,
    proveedor: r.proveedor,
    monto: r.monto,
    fechaPago: r.fechaPago.toISOString(),
    fileUrl: r.fileUrl,
    fileName: r.fileName,
    createdByName: r.createdBy?.name ?? null,
    createdAt: r.createdAt.toISOString(),
    changeRequest: r.changeRequest
      ? {
          action: r.changeRequest.action,
          requestedByName: r.changeRequest.requestedBy?.name ?? null,
          requestedAt: r.changeRequest.requestedAt.toISOString(),
          proposedProveedor: r.changeRequest.proposedProveedor,
          proposedMonto: r.changeRequest.proposedMonto,
          proposedFechaPago: r.changeRequest.proposedFechaPago?.toISOString() ?? null,
          proposedFileUrl: r.changeRequest.proposedFileUrl,
          proposedFileName: r.changeRequest.proposedFileName,
        }
      : null,
  }));
}
