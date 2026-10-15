-- Prórrogas del ID madre y caídas de Dropi (pedido del usuario 2026-10-15).
-- CreateTable
CREATE TABLE "HandoffExtension" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "hours" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "photoUrl" TEXT,
    "requestedById" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedAt" TIMESTAMP(3),
    "grantedById" TEXT,
    "auto" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "HandoffExtension_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DropiOutage" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedById" TEXT,
    "note" TEXT,
    "endedAt" TIMESTAMP(3),
    "endedById" TEXT,
    "remindedAt" TIMESTAMP(3),

    CONSTRAINT "DropiOutage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HandoffExtension_proposalId_idx" ON "HandoffExtension"("proposalId");

-- CreateIndex
CREATE INDEX "HandoffExtension_grantedAt_idx" ON "HandoffExtension"("grantedAt");

-- CreateIndex
CREATE INDEX "DropiOutage_endedAt_idx" ON "DropiOutage"("endedAt");

-- AddForeignKey
ALTER TABLE "HandoffExtension" ADD CONSTRAINT "HandoffExtension_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "MarketProductProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "HandoffExtension" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DropiOutage" ENABLE ROW LEVEL SECURITY;
