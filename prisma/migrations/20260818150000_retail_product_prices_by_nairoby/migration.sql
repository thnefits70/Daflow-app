-- Vuelve el precio al catálogo — lo mantiene Nairoby (nunca Daniel), puede
-- cambiar de a poco. El colaborador nunca lo ve, solo aparece en su Rol de
-- pago cuando se descuenta.
ALTER TABLE "RetailProduct" ADD COLUMN "costPrice" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "RetailProduct" ADD COLUMN "dropiPrice" DOUBLE PRECISION NOT NULL DEFAULT 0;
