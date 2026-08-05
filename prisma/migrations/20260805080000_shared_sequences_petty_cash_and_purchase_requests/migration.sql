-- DropIndex (era un contador por caja — confirmado 2026-08-05: debe ser UNO
-- solo compartido entre Principal y Secundaria, no dos independientes)
DROP INDEX "PettyCashEntry_boxId_requestNumber_key";

-- AlterTable
ALTER TABLE "PettyCashBox" DROP COLUMN "lastRequestNumber";

-- AlterTable: requestNumber pasa a ser autoincrement real de Postgres —
-- un solo contador para toda la tabla (las dos cajas comparten la secuencia).
CREATE SEQUENCE "PettyCashEntry_requestNumber_seq";
ALTER SEQUENCE "PettyCashEntry_requestNumber_seq" OWNED BY "PettyCashEntry"."requestNumber";
ALTER TABLE "PettyCashEntry" ALTER COLUMN "requestNumber" SET DEFAULT nextval('"PettyCashEntry_requestNumber_seq"');

-- CreateIndex
CREATE UNIQUE INDEX "PettyCashEntry_requestNumber_key" ON "PettyCashEntry"("requestNumber");

-- AlterTable: código correlativo de Control de Compras (SC-001, SC-002...)
ALTER TABLE "PurchaseRequest" ADD COLUMN "requestNumber" INTEGER;

-- AlterTable: contador único compartido para Control de Compras
ALTER TABLE "PlatformSettings" ADD COLUMN "lastPurchaseRequestNumber" INTEGER NOT NULL DEFAULT 0;

-- Backfill: la única solicitud que ya existía en producción queda como SC-001,
-- y el contador arranca en 1 para que la próxima sea SC-002.
UPDATE "PurchaseRequest" SET "requestNumber" = 1;
UPDATE "PlatformSettings" SET "lastPurchaseRequestNumber" = 1;
