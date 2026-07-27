-- CreateTable
CREATE TABLE "NancyConversation" (
    "id" TEXT NOT NULL,
    "deptId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NancyConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NancyMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NancyMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NancyConversation_deptId_ownerId_idx" ON "NancyConversation"("deptId", "ownerId");

-- CreateIndex
CREATE INDEX "NancyMessage_conversationId_idx" ON "NancyMessage"("conversationId");

-- AddForeignKey
ALTER TABLE "NancyConversation" ADD CONSTRAINT "NancyConversation_deptId_fkey" FOREIGN KEY ("deptId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NancyMessage" ADD CONSTRAINT "NancyMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "NancyConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
