-- Interruptores propios para "Qué comprar" (pedido del usuario 2026-10-13).
ALTER TABLE "User" ADD COLUMN     "handlesColdPurchases" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "handlesHotPurchases" BOOLEAN NOT NULL DEFAULT false;

-- Arrancan encendidos para quienes ya lo hacían, así nada cambia el primer día:
-- calientes = el criterio anterior (Control de Compras + Análisis de Mercado).
UPDATE "User" SET "handlesHotPurchases" = true
WHERE "isActive" = true AND "canManagePurchases" = true AND "purchasingNewRequestsBlocked" = false
  AND "deptId" IN (SELECT "id" FROM "Department" WHERE "code" = 'MKT');

-- frías = líder de Finanzas.
UPDATE "User" SET "handlesColdPurchases" = true
WHERE "isActive" = true AND "isLeader" = true
  AND "leadsDeptId" IN (SELECT "id" FROM "Department" WHERE "code" = 'FIN');
