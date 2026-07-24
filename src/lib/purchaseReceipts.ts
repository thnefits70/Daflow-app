import { prisma } from "@/lib/prisma";

export type PurchaseReceiptCatalogDTO = { id: string; name: string };

export type PurchaseReceiptChangeRequestDTO = {
  action: "EDIT" | "DELETE";
  requestedByName: string | null;
  requestedAt: string;
  proposedSupplierName: string | null;
  proposedNumeroComprobante: string | null;
  proposedBankName: string | null;
  proposedMonto: number | null;
  proposedFechaPago: string | null;
  proposedFileUrl: string | null;
  proposedFileName: string | null;
};

export type PurchaseReceiptDTO = {
  id: string;
  supplierName: string;
  numeroComprobante: string | null;
  bankName: string | null;
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
      supplier: { select: { name: true } },
      bank: { select: { name: true } },
      createdBy: { select: { name: true } },
      changeRequest: {
        include: {
          requestedBy: { select: { name: true } },
          // Proposed supplier/bank are resolved via their own catalog ids —
          // fetched separately below since Prisma can't relate a nullable FK
          // that doesn't have a matching relation field on the request model
          // for every combination without extra joins.
        },
      },
    },
  });

  // Resolve proposed supplier/bank names for any pending EDIT requests in one
  // extra pass — cheap, and keeps the change-request model free of two more
  // relation fields that would only ever be read here.
  const proposedSupplierIds = receipts
    .map((r) => r.changeRequest?.proposedSupplierId)
    .filter((id): id is string => !!id);
  const proposedBankIds = receipts.map((r) => r.changeRequest?.proposedBankId).filter((id): id is string => !!id);
  const [proposedSuppliers, proposedBanks] = await Promise.all([
    proposedSupplierIds.length
      ? prisma.purchaseReceiptSupplier.findMany({ where: { id: { in: proposedSupplierIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    proposedBankIds.length
      ? prisma.purchaseReceiptBank.findMany({ where: { id: { in: proposedBankIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);
  const supplierNameById = new Map(proposedSuppliers.map((s) => [s.id, s.name]));
  const bankNameById = new Map(proposedBanks.map((b) => [b.id, b.name]));

  return receipts.map((r) => ({
    id: r.id,
    supplierName: r.supplier.name,
    numeroComprobante: r.numeroComprobante,
    bankName: r.bank?.name ?? null,
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
          proposedSupplierName: r.changeRequest.proposedSupplierId
            ? (supplierNameById.get(r.changeRequest.proposedSupplierId) ?? null)
            : null,
          proposedNumeroComprobante: r.changeRequest.proposedNumeroComprobante,
          proposedBankName: r.changeRequest.proposedBankId ? (bankNameById.get(r.changeRequest.proposedBankId) ?? null) : null,
          proposedMonto: r.changeRequest.proposedMonto,
          proposedFechaPago: r.changeRequest.proposedFechaPago?.toISOString() ?? null,
          proposedFileUrl: r.changeRequest.proposedFileUrl,
          proposedFileName: r.changeRequest.proposedFileName,
        }
      : null,
  }));
}

export async function getPurchaseReceiptCatalogs(
  deptId: string
): Promise<{ suppliers: PurchaseReceiptCatalogDTO[]; banks: PurchaseReceiptCatalogDTO[] }> {
  const [suppliers, banks] = await Promise.all([
    prisma.purchaseReceiptSupplier.findMany({ where: { deptId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.purchaseReceiptBank.findMany({ where: { deptId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  return { suppliers, banks };
}
