-- CreateTable
CREATE TABLE "PayrollMessage" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "PayrollMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PayrollMessage_employeeId_idx" ON "PayrollMessage"("employeeId");

-- AddForeignKey
ALTER TABLE "PayrollMessage" ADD CONSTRAINT "PayrollMessage_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollMessage" ADD CONSTRAINT "PayrollMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
