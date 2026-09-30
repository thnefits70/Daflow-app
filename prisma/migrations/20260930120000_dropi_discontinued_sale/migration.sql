-- Pedido del usuario 2026-09-30: producto vendido en Dropi pero dado de baja.
CREATE TABLE "DropiDiscontinuedSale" (
    "id" TEXT NOT NULL,
    "batchId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "guideNumbers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "carriers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reportedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delistedById" TEXT,
    "delistedAt" TIMESTAMP(3),

    CONSTRAINT "DropiDiscontinuedSale_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DropiDiscontinuedSale_code_idx" ON "DropiDiscontinuedSale"("code");

CREATE INDEX "DropiDiscontinuedSale_delistedAt_idx" ON "DropiDiscontinuedSale"("delistedAt");

CREATE INDEX "DropiDiscontinuedSale_batchId_idx" ON "DropiDiscontinuedSale"("batchId");

ALTER TABLE "DropiDiscontinuedSale" ADD CONSTRAINT "DropiDiscontinuedSale_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "FulfillmentRequestBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
