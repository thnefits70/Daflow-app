-- Rediseño completo de Compras personales: se elimina el catálogo de
-- productos con precio (RetailProduct) y la tabla vieja PersonalPurchase,
-- reemplazadas por orden + ítems. Sin datos reales en producción todavía
-- (nunca se probó de punta a punta), así que no hace falta migrar filas.
-- Se agrega también Notification (campanita de notificaciones).

DROP TABLE "PersonalPurchase";
DROP TABLE "RetailProduct";

CREATE TABLE "PersonalPurchaseOrder" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "status" "PersonalPurchaseStatus" NOT NULL DEFAULT 'PENDING_INVENTORY',
    "inventoryConfirmedAt" TIMESTAMP(3),
    "inventoryConfirmedById" TEXT,
    "financeConfirmedAt" TIMESTAMP(3),
    "financeConfirmedById" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectedById" TEXT,
    "rejectionReason" TEXT,
    "pickedUpAt" TIMESTAMP(3),
    "eventMonth" TEXT NOT NULL,
    "installments" INTEGER NOT NULL DEFAULT 1,
    "firstPayoutMonth" TEXT,
    "totalAmount" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonalPurchaseOrder_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PersonalPurchaseOrder_employeeId_idx" ON "PersonalPurchaseOrder"("employeeId");

ALTER TABLE "PersonalPurchaseOrder" ADD CONSTRAINT "PersonalPurchaseOrder_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PersonalPurchaseItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "employeeProductName" TEXT NOT NULL,
    "confirmedProductName" TEXT,
    "livePhotoUrl" TEXT NOT NULL,
    "optionalPhotoUrl" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitDeclarations" JSONB NOT NULL,
    "unitPriceModes" JSONB,
    "costUnitPrice" DOUBLE PRECISION,
    "dropiUnitPrice" DOUBLE PRECISION,
    "itemTotal" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonalPurchaseItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PersonalPurchaseItem_orderId_idx" ON "PersonalPurchaseItem"("orderId");

ALTER TABLE "PersonalPurchaseItem" ADD CONSTRAINT "PersonalPurchaseItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PersonalPurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "url" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Notification_ownerId_createdAt_idx" ON "Notification"("ownerId", "createdAt");
