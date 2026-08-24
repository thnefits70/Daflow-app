-- CreateTable
CREATE TABLE "FernickConversation" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FernickConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FernickMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FernickMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FernickConversation_ownerId_idx" ON "FernickConversation"("ownerId");

-- CreateIndex
CREATE INDEX "FernickMessage_conversationId_idx" ON "FernickMessage"("conversationId");

-- AddForeignKey
ALTER TABLE "FernickMessage" ADD CONSTRAINT "FernickMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "FernickConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
