-- AlterTable: default para futuras filas creadas sin pasar el precio explícito
ALTER TABLE "LunchPaymentSettings" ALTER COLUMN "pricePerLunch" SET DEFAULT 2.5;

-- Fila única con el precio real vigente hoy (confirmado por el usuario:
-- $2.50 por almuerzo, IVA incluido) — para que el flujo funcione sin que
-- alguien tenga que configurarlo antes de poder usarlo.
INSERT INTO "LunchPaymentSettings" (id, "pricePerLunch", "updatedAt")
VALUES ('lunch-payment-settings-singleton', 2.5, now())
ON CONFLICT (id) DO NOTHING;
