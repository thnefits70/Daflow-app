-- CreateTable
CREATE TABLE "ProvedixSnapshot" (
    "id" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProvedixSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProvedixSnapshot_day_key" ON "ProvedixSnapshot"("day");
