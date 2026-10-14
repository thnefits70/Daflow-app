-- Marcas que no coinciden con el manifiesto (pedido del usuario 2026-10-14).
CREATE TABLE "ManifestBrandConflict" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "storedBrand" "MarketProductBodega" NOT NULL,
    "manifestBrand" "MarketProductBodega" NOT NULL,
    "forAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolution" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolvedByName" TEXT,

    CONSTRAINT "ManifestBrandConflict_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ManifestBrandConflict_kind_code_storedBrand_manifestBrand_key" ON "ManifestBrandConflict"("kind", "code", "storedBrand", "manifestBrand");
CREATE INDEX "ManifestBrandConflict_resolvedAt_idx" ON "ManifestBrandConflict"("resolvedAt");

-- Igual que el resto de tablas: sin acceso por la API REST de Supabase.
ALTER TABLE "ManifestBrandConflict" ENABLE ROW LEVEL SECURITY;
