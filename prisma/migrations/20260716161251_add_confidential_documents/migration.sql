-- CreateTable
CREATE TABLE "ConfidentialDocument" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT,
    "storagePath" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConfidentialDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfidentialDocumentAccess" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seenAt" TIMESTAMP(3),

    CONSTRAINT "ConfidentialDocumentAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConfidentialDocument_category_idx" ON "ConfidentialDocument"("category");

-- CreateIndex
CREATE INDEX "ConfidentialDocumentAccess_documentId_idx" ON "ConfidentialDocumentAccess"("documentId");

-- CreateIndex
CREATE INDEX "ConfidentialDocumentAccess_userId_idx" ON "ConfidentialDocumentAccess"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ConfidentialDocumentAccess_documentId_userId_key" ON "ConfidentialDocumentAccess"("documentId", "userId");

-- AddForeignKey
ALTER TABLE "ConfidentialDocumentAccess" ADD CONSTRAINT "ConfidentialDocumentAccess_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ConfidentialDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfidentialDocumentAccess" ADD CONSTRAINT "ConfidentialDocumentAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
