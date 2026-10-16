
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "canAccessNick" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "NickDropiAccount" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "accessTokenEnc" TEXT,
    "refreshTokenEnc" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "dropiIdentity" TEXT,
    "connectedAt" TIMESTAMP(3),
    "connectedById" TEXT,
    "lastReadAt" TIMESTAMP(3),
    "lastError" TEXT,
    "needsReconnect" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NickDropiAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NickOAuthClient" (
    "redirectUri" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NickOAuthClient_pkey" PRIMARY KEY ("redirectUri")
);

-- CreateIndex
CREATE UNIQUE INDEX "NickDropiAccount_name_key" ON "NickDropiAccount"("name");

-- AddForeignKey
ALTER TABLE "NickDropiAccount" ADD CONSTRAINT "NickDropiAccount_connectedById_fkey" FOREIGN KEY ("connectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Mismo criterio que 20261012170000: tablas cerradas a la API REST de Supabase.
ALTER TABLE "NickDropiAccount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NickOAuthClient" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "NickDropiAccount" FROM anon, authenticated;
REVOKE ALL ON TABLE "NickOAuthClient" FROM anon, authenticated;

-- Las 3 cuentas de proveedor en Dropi (sin conectar).
INSERT INTO "NickDropiAccount" ("id", "name", "sortOrder", "updatedAt") VALUES
  ('nick_acc_importadora_damian', 'IMPORTADORA DAMIAN', 1, CURRENT_TIMESTAMP),
  ('nick_acc_provedix', 'PROVEDIX', 2, CURRENT_TIMESTAMP),
  ('nick_acc_importadora_shanghai', 'IMPORTADORA SHANGHAI', 3, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;
