-- CreateTable
CREATE TABLE "ProvedixCase" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "chatId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "guideNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ABIERTO',
    "resolution" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProvedixCase_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "ProvedixAnswer" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "caseId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProvedixAnswer_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "ProvedixCase_number_key" ON "ProvedixCase"("number");
-- CreateIndex
CREATE INDEX "ProvedixCase_status_idx" ON "ProvedixCase"("status");
-- CreateIndex
CREATE INDEX "ProvedixCase_createdAt_idx" ON "ProvedixCase"("createdAt");
-- CreateIndex
CREATE INDEX "ProvedixAnswer_active_idx" ON "ProvedixAnswer"("active");
-- AddForeignKey
ALTER TABLE "ProvedixCase" ADD CONSTRAINT "ProvedixCase_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "ProvedixChat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
