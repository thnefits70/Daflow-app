-- AlterTable
ALTER TABLE "ProvedixCase" ADD COLUMN "platform" TEXT NOT NULL DEFAULT 'dropi';

-- CreateTable
CREATE TABLE "ProvedixChatAttachment" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProvedixChatAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProvedixChatAttachment_chatId_createdAt_idx" ON "ProvedixChatAttachment"("chatId", "createdAt");

-- AddForeignKey
ALTER TABLE "ProvedixChatAttachment" ADD CONSTRAINT "ProvedixChatAttachment_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "ProvedixChat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS como el resto de tablas (la API REST de Supabase está cerrada).
ALTER TABLE "ProvedixChatAttachment" ENABLE ROW LEVEL SECURITY;
