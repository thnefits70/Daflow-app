-- CreateTable
CREATE TABLE "NickScoreDay" (
    "day" TEXT NOT NULL,
    "score" DOUBLE PRECISION,
    "delivered" DOUBLE PRECISION,
    "movement" DOUBLE PRECISION,
    "novelty" DOUBLE PRECISION,
    "recovery" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NickScoreDay_pkey" PRIMARY KEY ("day")
);

-- Mismo criterio que 20261012170000: tabla cerrada a la API REST de Supabase.
ALTER TABLE "NickScoreDay" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "NickScoreDay" FROM anon, authenticated;
