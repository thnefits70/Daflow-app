-- Pedido del usuario 2026-10-03: los productos publicados cuyo precio mínimo
-- subió el 2026-10-02 (unidades a $0 + freno 10%) toman como referencia el
-- mínimo de ANTES, para que a la asesora B2B le salga el aviso y lo revise
-- en Dropi. No pisa lo que ella ya haya confirmado (dropiPriceRefById).
UPDATE "PurchaseCatalogItem" SET "dropiPriceRef" = 5.76, "dropiPriceRefAt" = NOW(), "dropiPriceRefById" = NULL WHERE "id" = 'cmt7qvt6t002q04la9e3s3w6d' AND "dropiPriceRefById" IS NULL;
UPDATE "PurchaseCatalogItem" SET "dropiPriceRef" = 1.77, "dropiPriceRefAt" = NOW(), "dropiPriceRefById" = NULL WHERE "id" = 'cmsxcmlom000104l4zioaq1rd' AND "dropiPriceRefById" IS NULL;
UPDATE "PurchaseCatalogItem" SET "dropiPriceRef" = 2.18, "dropiPriceRefAt" = NOW(), "dropiPriceRefById" = NULL WHERE "id" = 'cmt7qvt6t001v04laibehsmnm' AND "dropiPriceRefById" IS NULL;
UPDATE "PurchaseCatalogItem" SET "dropiPriceRef" = 14.73, "dropiPriceRefAt" = NOW(), "dropiPriceRefById" = NULL WHERE "id" = 'cmt7qvt6x00ay04lak826hcl9' AND "dropiPriceRefById" IS NULL;
UPDATE "PurchaseCatalogItem" SET "dropiPriceRef" = 14.19, "dropiPriceRefAt" = NOW(), "dropiPriceRefById" = NULL WHERE "id" = 'cmt7qvt6w007v04lagssxbrqj' AND "dropiPriceRefById" IS NULL;
UPDATE "PurchaseCatalogItem" SET "dropiPriceRef" = 13.86, "dropiPriceRefAt" = NOW(), "dropiPriceRefById" = NULL WHERE "id" = 'cmsyvp8mx000104jlthrn7t9s' AND "dropiPriceRefById" IS NULL;
UPDATE "PurchaseCatalogItem" SET "dropiPriceRef" = 5.1, "dropiPriceRefAt" = NOW(), "dropiPriceRefById" = NULL WHERE "id" = 'cmt7qvt6t000y04lamuu649vt' AND "dropiPriceRefById" IS NULL;
UPDATE "PurchaseCatalogItem" SET "dropiPriceRef" = 1.86, "dropiPriceRefAt" = NOW(), "dropiPriceRefById" = NULL WHERE "id" = 'cmt7qvt6x00av04latif7q8y8' AND "dropiPriceRefById" IS NULL;
UPDATE "PurchaseCatalogItem" SET "dropiPriceRef" = 9.23, "dropiPriceRefAt" = NOW(), "dropiPriceRefById" = NULL WHERE "id" = 'cmt7qvt6v005l04la42ak803l' AND "dropiPriceRefById" IS NULL;
UPDATE "PurchaseCatalogItem" SET "dropiPriceRef" = 3.32, "dropiPriceRefAt" = NOW(), "dropiPriceRefById" = NULL WHERE "id" = 'cmsoyqtah000104k0o90k5xt2' AND "dropiPriceRefById" IS NULL;
UPDATE "PurchaseCatalogItem" SET "dropiPriceRef" = 5.68, "dropiPriceRefAt" = NOW(), "dropiPriceRefById" = NULL WHERE "id" = 'cmt7qvt6t001x04la8qw5okmx' AND "dropiPriceRefById" IS NULL;
UPDATE "PurchaseCatalogItem" SET "dropiPriceRef" = 2.09, "dropiPriceRefAt" = NOW(), "dropiPriceRefById" = NULL WHERE "id" = 'cmt7qvt6v004604lay1tpk459' AND "dropiPriceRefById" IS NULL;
