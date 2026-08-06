-- Elimina el módulo legado "Comprobante de pago" (Gestión de Compras),
-- reemplazado por completo por Control de Compras. Nunca se registró ningún
-- comprobante real (0 filas) — solo quedaban 2 proveedores y 2 bancos de
-- catálogo sin uso.
DROP TABLE IF EXISTS "PurchaseReceiptChangeRequest";
DROP TABLE IF EXISTS "PurchaseReceipt";
DROP TABLE IF EXISTS "PurchaseReceiptSupplier";
DROP TABLE IF EXISTS "PurchaseReceiptBank";
DROP TYPE IF EXISTS "PurchaseReceiptAction";

ALTER TABLE "User" DROP COLUMN IF EXISTS "canViewPurchaseReceipts";
