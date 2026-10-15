-- Notas de variantes al proponer un producto (pedido de Jariel 2026-10-15).
ALTER TABLE "MarketProductProposal" ADD COLUMN "hasVariants" BOOLEAN;
ALTER TABLE "MarketProductProposal" ADD COLUMN "variantNotes" TEXT;
