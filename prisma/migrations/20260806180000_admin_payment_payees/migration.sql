-- A quién y a qué cuenta bancaria se le paga en Pagos administrativos —
-- catálogo liviano y reutilizable, deliberadamente sin los campos de
-- Supplier que no aplican acá (ubicación, categoría, aprobación, WhatsApp).

CREATE TABLE "AdminPaymentPayee" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminPaymentPayee_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdminPaymentPayee_name_key" ON "AdminPaymentPayee"("name");

CREATE TABLE "AdminPaymentPayeeBankAccount" (
    "id" TEXT NOT NULL,
    "payeeId" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "bankAccountType" TEXT NOT NULL,
    "bankAccountNumber" TEXT NOT NULL,
    "bankAccountHolder" TEXT NOT NULL,
    "holderIdType" "HolderIdType",
    "holderIdNumber" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminPaymentPayeeBankAccount_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AdminPaymentPayeeBankAccount_payeeId_idx" ON "AdminPaymentPayeeBankAccount"("payeeId");

ALTER TABLE "AdminPaymentPayee" ADD CONSTRAINT "AdminPaymentPayee_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AdminPaymentPayeeBankAccount" ADD CONSTRAINT "AdminPaymentPayeeBankAccount_payeeId_fkey" FOREIGN KEY ("payeeId") REFERENCES "AdminPaymentPayee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdminPaymentPayeeBankAccount" ADD CONSTRAINT "AdminPaymentPayeeBankAccount_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AdminPaymentRequest" ADD COLUMN "payeeId" TEXT;
ALTER TABLE "AdminPaymentRequest" ADD COLUMN "bankAccountId" TEXT;
ALTER TABLE "AdminPaymentRequest" ADD CONSTRAINT "AdminPaymentRequest_payeeId_fkey" FOREIGN KEY ("payeeId") REFERENCES "AdminPaymentPayee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AdminPaymentRequest" ADD CONSTRAINT "AdminPaymentRequest_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "AdminPaymentPayeeBankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
