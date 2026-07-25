-- CreateTable
CREATE TABLE "Module" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "imageUrl" TEXT,
    "imageName" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Module_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Module_order_idx" ON "Module"("order");

-- AlterTable
ALTER TABLE "Document" ADD COLUMN "moduleId" TEXT;

-- CreateIndex
CREATE INDEX "Document_moduleId_idx" ON "Document"("moduleId");

-- AlterTable
ALTER TABLE "Exam" ADD COLUMN "moduleId" TEXT,
ALTER COLUMN "deptId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Exam_moduleId_key" ON "Exam"("moduleId");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exam" ADD CONSTRAINT "Exam_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module"("id") ON DELETE CASCADE ON UPDATE CASCADE;
