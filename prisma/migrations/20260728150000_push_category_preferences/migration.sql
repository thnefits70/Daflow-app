-- CreateTable
CREATE TABLE "PushCategoryPreference" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "disabledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushCategoryPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PushCategoryPreference_ownerId_idx" ON "PushCategoryPreference"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "PushCategoryPreference_ownerId_type_key" ON "PushCategoryPreference"("ownerId", "type");
