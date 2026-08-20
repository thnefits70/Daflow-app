-- Confirmado 2026-08-20: un colaborador puede registrar varias cuentas
-- bancarias; isSelected marca cuál está activa para transferir anticipos.
-- Cuentas existentes quedan como isSelected = true (default).

DROP INDEX "EmployeeBankAccount_employeeId_key";

ALTER TABLE "EmployeeBankAccount" ADD COLUMN "isSelected" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX "EmployeeBankAccount_employeeId_idx" ON "EmployeeBankAccount"("employeeId");
