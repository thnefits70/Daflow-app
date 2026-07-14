-- CreateTable
CREATE TABLE "SupplierChannel" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "url" TEXT NOT NULL,

    CONSTRAINT "SupplierChannel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierChannel_supplierId_idx" ON "SupplierChannel"("supplierId");

-- AddForeignKey
ALTER TABLE "SupplierChannel" ADD CONSTRAINT "SupplierChannel_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
