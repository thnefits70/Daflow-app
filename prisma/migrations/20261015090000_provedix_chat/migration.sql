-- Conversaciones con Michelle, asistente virtual de provedix.com (2026-10-15).
CREATE TABLE "ProvedixChat" (
    "id" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "leadId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProvedixChat_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ProvedixChatMessage" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProvedixChatMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProvedixChat_visitorId_idx" ON "ProvedixChat"("visitorId");
CREATE INDEX "ProvedixChat_leadId_idx" ON "ProvedixChat"("leadId");
CREATE INDEX "ProvedixChat_updatedAt_idx" ON "ProvedixChat"("updatedAt");
CREATE INDEX "ProvedixChatMessage_chatId_createdAt_idx" ON "ProvedixChatMessage"("chatId", "createdAt");
CREATE INDEX "ProvedixChatMessage_createdAt_idx" ON "ProvedixChatMessage"("createdAt");
ALTER TABLE "ProvedixChat" ADD CONSTRAINT "ProvedixChat_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "ProvedixLead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProvedixChatMessage" ADD CONSTRAINT "ProvedixChatMessage_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "ProvedixChat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
