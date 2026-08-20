-- Reglas de anticipos 2026-08-20: motivo obligatorio arriba de $100
-- (emergencia familiar u otro con descripción).

CREATE TYPE "SalaryAdvanceReason" AS ENUM ('EMERGENCIA_FAMILIAR', 'OTRO');

ALTER TABLE "SalaryAdvance" ADD COLUMN "reason" "SalaryAdvanceReason";
