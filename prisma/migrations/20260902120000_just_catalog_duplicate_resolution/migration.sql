-- Confirmado 2026-09-02, pedido explícito de Daniel: que su decisión sobre
-- un nombre repetido en Just (cuál código mantener, o si son productos
-- distintos) quede guardada, para que la IA no le vuelva a preguntar lo
-- mismo en cada subida.

-- CreateTable
CREATE TABLE "JustCatalogDuplicateResolution" (
    "id" TEXT NOT NULL,
    "groupKey" TEXT NOT NULL,
    "groupName" TEXT NOT NULL,
    "codes" TEXT[],
    "decision" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JustCatalogDuplicateResolution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JustCatalogDuplicateResolution_groupKey_key" ON "JustCatalogDuplicateResolution"("groupKey");

-- AddForeignKey
ALTER TABLE "JustCatalogDuplicateResolution" ADD CONSTRAINT "JustCatalogDuplicateResolution_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
