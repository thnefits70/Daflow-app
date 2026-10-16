-- CreateTable
CREATE TABLE "ProvedixRating" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "comment" TEXT,
    "allowPublic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProvedixRating_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "ProvedixRating_tool_createdAt_idx" ON "ProvedixRating"("tool", "createdAt");
-- CreateIndex
CREATE INDEX "ProvedixRating_leadId_tool_idx" ON "ProvedixRating"("leadId", "tool");
-- AddForeignKey
ALTER TABLE "ProvedixRating" ADD CONSTRAINT "ProvedixRating_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "ProvedixLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
