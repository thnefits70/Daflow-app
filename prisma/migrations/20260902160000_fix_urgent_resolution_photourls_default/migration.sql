-- Bug fix: 20260818140000_inventory_team_receiving_review dropped the
-- DEFAULT on this column while leaving it NOT NULL, so every new
-- PurchaseUrgentResolution (crédito, cambio, reembolso o pérdida) failed
-- with a null constraint violation as soon as it was created. Restoring the
-- default matches schema.prisma's @default([]) — no existing rows change.
ALTER TABLE "PurchaseUrgentResolution" ALTER COLUMN "replacementPhotoUrls" SET DEFAULT '{}';
