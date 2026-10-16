-- CreateTable
CREATE TABLE "ProvedixTeamPhoto" (
    "id" TEXT NOT NULL,
    "driveId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "kind" TEXT,
    "url" TEXT,
    "title" TEXT,
    "alt" TEXT,
    "score" INTEGER,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProvedixTeamPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProvedixTeamPhoto_driveId_key" ON "ProvedixTeamPhoto"("driveId");

-- CreateIndex
CREATE INDEX "ProvedixTeamPhoto_status_idx" ON "ProvedixTeamPhoto"("status");

-- RLS como el resto de tablas (la API REST de Supabase está cerrada).
ALTER TABLE "ProvedixTeamPhoto" ENABLE ROW LEVEL SECURITY;
