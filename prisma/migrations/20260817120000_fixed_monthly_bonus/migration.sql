-- Bono fijo mensual por persona, que se suma al sueldo base. Nairoby (o
-- admin) propone el monto (pendingAmount), pero queda inactivo hasta que
-- el admin lo aprueba (amount). Mismo patrón que CommissionTierAmount.
CREATE TABLE "FixedMonthlyBonus" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pendingAmount" DOUBLE PRECISION,
    "proposedAt" TIMESTAMP(3),
    "proposedById" TEXT,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "FixedMonthlyBonus_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FixedMonthlyBonus_userId_key" ON "FixedMonthlyBonus"("userId");

ALTER TABLE "FixedMonthlyBonus" ADD CONSTRAINT "FixedMonthlyBonus_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FixedMonthlyBonus" ADD CONSTRAINT "FixedMonthlyBonus_proposedById_fkey" FOREIGN KEY ("proposedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
