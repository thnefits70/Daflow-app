-- CreateTable
CREATE TABLE "DropiPrivatization" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "account" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "catalogItemId" TEXT,
    "units" INTEGER NOT NULL,
    "email" TEXT NOT NULL,
    "storeName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "goalUnits" INTEGER NOT NULL,
    "deadline" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'APPROVAL',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "privatizedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "endedById" TEXT,
    "endNote" TEXT,
    "soldUnits" INTEGER,
    "outcome" TEXT,

    CONSTRAINT "DropiPrivatization_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DropiPrivatization_number_key" ON "DropiPrivatization"("number");

-- CreateIndex
CREATE INDEX "DropiPrivatization_email_idx" ON "DropiPrivatization"("email");

-- CreateIndex
CREATE INDEX "DropiPrivatization_status_idx" ON "DropiPrivatization"("status");

-- CreateIndex
CREATE INDEX "DropiPrivatization_productId_idx" ON "DropiPrivatization"("productId");


-- Mismo criterio que 20261012170000: tabla cerrada a la API REST de Supabase.
ALTER TABLE "DropiPrivatization" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "DropiPrivatization" FROM anon, authenticated;
REVOKE ALL ON SEQUENCE "DropiPrivatization_number_seq" FROM anon, authenticated;
