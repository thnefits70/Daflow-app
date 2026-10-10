-- Pedido del usuario 2026-10-10: un combo, una sola marca madre.

-- AlterTable
ALTER TABLE "DropiCombo" ADD COLUMN     "aliasOfId" TEXT;

-- AddForeignKey
ALTER TABLE "DropiCombo" ADD CONSTRAINT "DropiCombo_aliasOfId_fkey" FOREIGN KEY ("aliasOfId") REFERENCES "DropiCombo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 155679 (Almohada + Pistola masajeadora) tiene la misma receta que 162038,
-- que se registró primero en DAFLOW: pasa a ser su ID alterno, con su marca.
UPDATE "DropiCombo" AS a
SET "aliasOfId" = m."id", "bodega" = m."bodega"
FROM "DropiCombo" AS m
WHERE a."code" = '155679' AND m."code" = '162038';

-- 144909: Daniel confirmó que es de Importadora Damián.
UPDATE "DropiCombo" SET "bodega" = 'MKT_DAMIAN' WHERE "code" = '144909' AND "bodega" IS NULL;
