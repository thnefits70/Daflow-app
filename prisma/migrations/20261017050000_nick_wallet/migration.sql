-- CreateTable
CREATE TABLE "NickWalletUpload" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "rows" INTEGER NOT NULL,
    "skipped" INTEGER NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NickWalletUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NickWalletMovement" (
    "id" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "orderId" TEXT,
    "guideNumber" TEXT,
    "description" TEXT NOT NULL,

    CONSTRAINT "NickWalletMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NickWalletUpload_accountId_month_idx" ON "NickWalletUpload"("accountId", "month");

-- CreateIndex
CREATE INDEX "NickWalletMovement_guideNumber_idx" ON "NickWalletMovement"("guideNumber");

-- CreateIndex
CREATE INDEX "NickWalletMovement_accountId_at_idx" ON "NickWalletMovement"("accountId", "at");

-- CreateIndex
CREATE INDEX "NickWalletMovement_kind_idx" ON "NickWalletMovement"("kind");

-- AddForeignKey
ALTER TABLE "NickWalletMovement" ADD CONSTRAINT "NickWalletMovement_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "NickWalletUpload"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Mismo criterio que 20261012170000: tablas cerradas a la API REST de Supabase.
ALTER TABLE "NickWalletUpload" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NickWalletMovement" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "NickWalletUpload" FROM anon, authenticated;
REVOKE ALL ON TABLE "NickWalletMovement" FROM anon, authenticated;
