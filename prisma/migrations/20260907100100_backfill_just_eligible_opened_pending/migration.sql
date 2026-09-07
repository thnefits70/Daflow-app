-- Backfill 2026-09-07: los ítems que ya estaban pendientes de subir a Just
-- (y con 10 unidades o menos) ya habían pasado por al menos una ventana
-- semanal habilitada (el viernes 4 de sept) antes de este arreglo. Se
-- marcan como habilitados ahora mismo para que Nairoby pueda terminar de
-- subirlos sin esperar al próximo viernes.
UPDATE "MerchandiseReentryItem" AS item
SET "justEligibleOpenedAt" = NOW()
FROM "MerchandiseReentryBatch" AS batch
WHERE item."batchId" = batch.id
  AND item."goodQty" > 0
  AND item."justUploadedAt" IS NULL
  AND item."justEligibleOpenedAt" IS NULL
  AND batch."danielApprovedAt" IS NOT NULL;
