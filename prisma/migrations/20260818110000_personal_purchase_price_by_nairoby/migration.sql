-- Corrección el mismo día: el catálogo NO guarda precio. Nairoby digita el
-- valor en dólares al cerrar cada compra personal (confirm-finance) — el
-- colaborador solo declara para quién es la compra.
ALTER TABLE "RetailProduct" DROP COLUMN "costPrice";
ALTER TABLE "RetailProduct" DROP COLUMN "dropiPrice";

ALTER TABLE "PersonalPurchase" ALTER COLUMN "unitPrice" DROP NOT NULL;
ALTER TABLE "PersonalPurchase" ALTER COLUMN "totalAmount" DROP NOT NULL;
