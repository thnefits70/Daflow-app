-- CreateTable
CREATE TABLE "ProvedixLead" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "whatsapp" TEXT NOT NULL,
    "consentAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "visits" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ProvedixLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProvedixEvent" (
    "id" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "leadId" TEXT,
    "type" TEXT NOT NULL,
    "query" TEXT,
    "productCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProvedixEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProvedixLead_whatsapp_key" ON "ProvedixLead"("whatsapp");

-- CreateIndex
CREATE INDEX "ProvedixLead_lastSeenAt_idx" ON "ProvedixLead"("lastSeenAt");

-- CreateIndex
CREATE INDEX "ProvedixEvent_createdAt_idx" ON "ProvedixEvent"("createdAt");

-- CreateIndex
CREATE INDEX "ProvedixEvent_leadId_idx" ON "ProvedixEvent"("leadId");

-- CreateIndex
CREATE INDEX "ProvedixEvent_visitorId_idx" ON "ProvedixEvent"("visitorId");

-- AddForeignKey
ALTER TABLE "ProvedixEvent" ADD CONSTRAINT "ProvedixEvent_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "ProvedixLead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
