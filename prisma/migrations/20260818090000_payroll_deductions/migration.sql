-- Egresos automáticos de nómina: compras personales, anticipos y
-- descuentos por mala gestión. Diseñado en conversación larga con el
-- usuario 2026-08-18.

CREATE TYPE "PurchaseBuyerRelation" AS ENUM ('SELF', 'MINOR_CHILD', 'OTHER_FAMILY');
CREATE TYPE "PersonalPurchaseStatus" AS ENUM ('PENDING_INVENTORY', 'PENDING_FINANCE', 'APPROVED', 'REJECTED');
CREATE TYPE "SalaryAdvanceStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "RetailProduct" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "photo" TEXT,
    "costPrice" DOUBLE PRECISION NOT NULL,
    "dropiPrice" DOUBLE PRECISION NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetailProduct_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RetailProduct_name_key" ON "RetailProduct"("name");

CREATE TABLE "PersonalPurchase" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "livePhotoUrl" TEXT NOT NULL,
    "buyerRelation" "PurchaseBuyerRelation" NOT NULL,
    "buyerNote" TEXT,
    "priceMode" TEXT NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "installments" INTEGER NOT NULL DEFAULT 1,
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
    "firstPayoutMonth" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonalPurchase_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PersonalPurchase_employeeId_idx" ON "PersonalPurchase"("employeeId");
CREATE INDEX "PersonalPurchase_productId_idx" ON "PersonalPurchase"("productId");

CREATE TABLE "EmployeeBankAccount" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "bankAccountType" TEXT NOT NULL,
    "bankAccountNumber" TEXT NOT NULL,
    "bankAccountHolder" TEXT NOT NULL,
    "holderIdType" "HolderIdType",
    "holderIdNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeBankAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmployeeBankAccount_employeeId_key" ON "EmployeeBankAccount"("employeeId");

CREATE TABLE "SalaryAdvance" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "justification" TEXT,
    "installments" INTEGER NOT NULL DEFAULT 1,
    "status" "SalaryAdvanceStatus" NOT NULL DEFAULT 'PENDING',
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "transferProofUrl" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectedById" TEXT,
    "firstPayoutMonth" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalaryAdvance_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SalaryAdvance_employeeId_idx" ON "SalaryAdvance"("employeeId");

CREATE TABLE "ManagementDeduction" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "evidenceUrl" TEXT,
    "installments" INTEGER NOT NULL DEFAULT 1,
    "startMonth" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "firstPayoutMonth" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManagementDeduction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ManagementDeduction_employeeId_idx" ON "ManagementDeduction"("employeeId");

ALTER TABLE "RetailProduct" ADD CONSTRAINT "RetailProduct_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PersonalPurchase" ADD CONSTRAINT "PersonalPurchase_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PersonalPurchase" ADD CONSTRAINT "PersonalPurchase_productId_fkey" FOREIGN KEY ("productId") REFERENCES "RetailProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmployeeBankAccount" ADD CONSTRAINT "EmployeeBankAccount_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalaryAdvance" ADD CONSTRAINT "SalaryAdvance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ManagementDeduction" ADD CONSTRAINT "ManagementDeduction_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
