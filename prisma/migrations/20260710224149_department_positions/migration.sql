-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL,
    "deptId" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Position_deptId_idx" ON "Position"("deptId");

-- CreateIndex
CREATE UNIQUE INDEX "Position_deptId_name_key" ON "Position"("deptId", "name");

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_deptId_fkey" FOREIGN KEY ("deptId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;
