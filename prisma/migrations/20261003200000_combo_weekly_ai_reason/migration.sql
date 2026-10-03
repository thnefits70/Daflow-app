-- Pedido del usuario 2026-10-03: combos semanales con explicación de la IA.
ALTER TYPE "ComboSuggestionStatus" ADD VALUE IF NOT EXISTS 'DESCARTADO';
ALTER TABLE "ComboSuggestion" ADD COLUMN IF NOT EXISTS "aiReason" TEXT;
