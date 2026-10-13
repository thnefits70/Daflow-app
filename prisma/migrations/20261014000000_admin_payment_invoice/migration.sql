-- Factura que el proveedor entrega después del pago (pedido de Nairoby 2026-10-13).
ALTER TABLE "AdminPaymentRequest" ADD COLUMN "invoiceFileUrl" TEXT;
ALTER TABLE "AdminPaymentRequest" ADD COLUMN "invoiceFileName" TEXT;
ALTER TABLE "AdminPaymentRequest" ADD COLUMN "invoiceUploadedAt" TIMESTAMP(3);
ALTER TABLE "AdminPaymentRequest" ADD COLUMN "invoiceUploadedById" TEXT;

ALTER TABLE "AdminPaymentRequest" ADD CONSTRAINT "AdminPaymentRequest_invoiceUploadedById_fkey" FOREIGN KEY ("invoiceUploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
