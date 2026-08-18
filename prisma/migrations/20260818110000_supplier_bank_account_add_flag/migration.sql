-- Escape hatch para delegar a personas puntuales (pedido explícito del
-- usuario 2026-08-18: hoy Jariel y Bryan) la posibilidad de AGREGAR una
-- cuenta bancaria a un proveedor desde Proveedores, sin darles acceso a ver
-- las cuentas ya registradas de otros proveedores (eso sigue siendo
-- exclusivo de admin).

ALTER TABLE "User" ADD COLUMN     "canAddSupplierBankAccounts" BOOLEAN NOT NULL DEFAULT false;
