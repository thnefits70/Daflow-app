-- Comisiones de equipo por niveles (Raíz/Cosecha/PROVEDIX, según el
-- promedio diario mensual de Pedidos despachados) + Bonos discrecionales
-- del CEO. Diseñado en conversación larga con el usuario 2026-08-14.

CREATE TYPE "CeoBonusType" AS ENUM ('ADICIONAL', 'PRODUCTIVIDAD', 'MERITO');

CREATE TABLE "CommissionTier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "minDailyAvg" DOUBLE PRECISION NOT NULL,
    "maxDailyAvg" DOUBLE PRECISION,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CommissionTier_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommissionTier_name_key" ON "CommissionTier"("name");
CREATE UNIQUE INDEX "CommissionTier_orderIndex_key" ON "CommissionTier"("orderIndex");

CREATE TABLE "CommissionTierAmount" (
    "id" TEXT NOT NULL,
    "tierId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pendingAmount" DOUBLE PRECISION,
    "proposedAt" TIMESTAMP(3),
    "proposedById" TEXT,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "CommissionTierAmount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommissionTierAmount_tierId_userId_key" ON "CommissionTierAmount"("tierId", "userId");

CREATE TABLE "CeoBonusGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "CeoBonusType" NOT NULL,
    "note" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CeoBonusGrant_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CeoBonusGrant_userId_idx" ON "CeoBonusGrant"("userId");

CREATE TABLE "CeoBonusGrantSeen" (
    "id" TEXT NOT NULL,
    "viewerId" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CeoBonusGrantSeen_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CeoBonusGrantSeen_viewerId_grantId_key" ON "CeoBonusGrantSeen"("viewerId", "grantId");

ALTER TABLE "CommissionTierAmount" ADD CONSTRAINT "CommissionTierAmount_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "CommissionTier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommissionTierAmount" ADD CONSTRAINT "CommissionTierAmount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommissionTierAmount" ADD CONSTRAINT "CommissionTierAmount_proposedById_fkey" FOREIGN KEY ("proposedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CeoBonusGrant" ADD CONSTRAINT "CeoBonusGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed de los 3 niveles — rangos de promedio diario mensual confirmados
-- por el usuario. Editables después por el admin (canManageCommissionTiers).
INSERT INTO "CommissionTier" ("id", "name", "orderIndex", "minDailyAvg", "maxDailyAvg", "isActive") VALUES
  ('commtier_raiz', 'Raíz', 1, 750, 849, true),
  ('commtier_cosecha', 'Cosecha', 2, 850, 949, true),
  ('commtier_provedix', 'PROVEDIX', 3, 950, 1050, true);
