-- Pagos administrativos (Finanzas) — solicitudes de pago recurrentes y
-- variables, con doc. de soporte opcional y comprobante de pago obligatorio,
-- ambos verificados por IA.

CREATE TYPE "AdminPaymentType" AS ENUM ('RECURRING', 'VARIABLE');
CREATE TYPE "AdminPaymentStatus" AS ENUM ('PENDING_PAYMENT', 'PAID', 'CONFIRMED');

ALTER TABLE "User" ADD COLUMN "canManageAdminPayments" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "AdminPaymentTemplate" (
    "id" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminPaymentTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminPaymentTemplate_motivo_key" ON "AdminPaymentTemplate"("motivo");

CREATE TABLE "AdminPaymentRequest" (
    "id" TEXT NOT NULL,
    "type" "AdminPaymentType" NOT NULL,
    "templateId" TEXT,
    "period" TEXT,
    "motivo" TEXT NOT NULL,
    "monto" DOUBLE PRECISION NOT NULL,
    "status" "AdminPaymentStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "declarationFileUrl" TEXT,
    "declarationFileName" TEXT,
    "declarationAiMatch" BOOLEAN,
    "declarationAiNote" TEXT,
    "paymentProofUrl" TEXT,
    "paymentProofName" TEXT,
    "paymentAiMatch" BOOLEAN,
    "paymentAiNote" TEXT,
    "paidAt" TIMESTAMP(3),
    "paidById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "confirmedById" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminPaymentRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminPaymentRequest_templateId_period_key" ON "AdminPaymentRequest"("templateId", "period");
CREATE INDEX "AdminPaymentRequest_status_idx" ON "AdminPaymentRequest"("status");
CREATE INDEX "AdminPaymentRequest_type_idx" ON "AdminPaymentRequest"("type");

ALTER TABLE "AdminPaymentTemplate" ADD CONSTRAINT "AdminPaymentTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AdminPaymentRequest" ADD CONSTRAINT "AdminPaymentRequest_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "AdminPaymentTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AdminPaymentRequest" ADD CONSTRAINT "AdminPaymentRequest_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AdminPaymentRequest" ADD CONSTRAINT "AdminPaymentRequest_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AdminPaymentRequest" ADD CONSTRAINT "AdminPaymentRequest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
