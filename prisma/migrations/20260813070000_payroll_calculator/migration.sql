-- Nómina: calculadora de horas extra y roles de pago — reemplaza el cálculo
-- manual en Excel. Detalle real exclusivo de Nairoby Castro (edita) y admin
-- (solo ve); los colaboradores solo ven MonthlyLegalRole ("Rol del mes").

CREATE TYPE "PayrollLineItemKind" AS ENUM ('INCOME', 'EXPENSE');
CREATE TYPE "PayrollPeriodStatus" AS ENUM ('DRAFT', 'PUBLISHED');

CREATE TABLE "PayrollProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "realSalary" DOUBLE PRECISION,
    "iessDeclaredSalary" DOUBLE PRECISION,
    "companyAbsorbsIess" BOOLEAN NOT NULL DEFAULT false,
    "canLogOvertimeHours" BOOLEAN NOT NULL DEFAULT false,
    "usesFullLegalOvertimeSchedule" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PayrollProfile_userId_key" ON "PayrollProfile"("userId");
CREATE INDEX "PayrollProfile_userId_idx" ON "PayrollProfile"("userId");

CREATE TABLE "PayrollSettings" (
    "id" TEXT NOT NULL,
    "nationalBaseSalary" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "PayrollSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OvertimeEntry" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "minutesExtra" INTEGER NOT NULL,
    "enteredById" TEXT,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,

    CONSTRAINT "OvertimeEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OvertimeEntry_employeeId_date_key" ON "OvertimeEntry"("employeeId", "date");
CREATE INDEX "OvertimeEntry_employeeId_idx" ON "OvertimeEntry"("employeeId");
CREATE INDEX "OvertimeEntry_approvedAt_idx" ON "OvertimeEntry"("approvedAt");

CREATE TABLE "PayrollPeriod" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "status" "PayrollPeriodStatus" NOT NULL DEFAULT 'DRAFT',
    "generatedAt" TIMESTAMP(3),
    "generatedById" TEXT,
    "publishedAt" TIMESTAMP(3),
    "publishedById" TEXT,

    CONSTRAINT "PayrollPeriod_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PayrollPeriod_period_key" ON "PayrollPeriod"("period");
CREATE INDEX "PayrollPeriod_status_idx" ON "PayrollPeriod"("status");

CREATE TABLE "PayrollQuincenaRole" (
    "id" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "changeNote" TEXT,
    "totalIncome" DOUBLE PRECISION NOT NULL,
    "totalExpense" DOUBLE PRECISION NOT NULL,
    "netTotal" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "PayrollQuincenaRole_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PayrollQuincenaRole_periodId_idx" ON "PayrollQuincenaRole"("periodId");
CREATE INDEX "PayrollQuincenaRole_employeeId_idx" ON "PayrollQuincenaRole"("employeeId");
CREATE INDEX "PayrollQuincenaRole_employeeId_isCurrent_idx" ON "PayrollQuincenaRole"("employeeId", "isCurrent");

CREATE TABLE "PayrollLineItem" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "kind" "PayrollLineItemKind" NOT NULL,
    "isAutomatic" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PayrollLineItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PayrollLineItem_roleId_idx" ON "PayrollLineItem"("roleId");

CREATE TABLE "MonthlyLegalRole" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "changeNote" TEXT,
    "declaredSalary" DOUBLE PRECISION NOT NULL,
    "iessDeduction" DOUBLE PRECISION NOT NULL,
    "netTotal" DOUBLE PRECISION NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedById" TEXT,

    CONSTRAINT "MonthlyLegalRole_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MonthlyLegalRole_employeeId_month_version_key" ON "MonthlyLegalRole"("employeeId", "month", "version");
CREATE INDEX "MonthlyLegalRole_employeeId_idx" ON "MonthlyLegalRole"("employeeId");
CREATE INDEX "MonthlyLegalRole_employeeId_isCurrent_idx" ON "MonthlyLegalRole"("employeeId", "isCurrent");

ALTER TABLE "PayrollProfile" ADD CONSTRAINT "PayrollProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PayrollSettings" ADD CONSTRAINT "PayrollSettings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OvertimeEntry" ADD CONSTRAINT "OvertimeEntry_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OvertimeEntry" ADD CONSTRAINT "OvertimeEntry_enteredById_fkey" FOREIGN KEY ("enteredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OvertimeEntry" ADD CONSTRAINT "OvertimeEntry_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PayrollPeriod" ADD CONSTRAINT "PayrollPeriod_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PayrollPeriod" ADD CONSTRAINT "PayrollPeriod_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PayrollQuincenaRole" ADD CONSTRAINT "PayrollQuincenaRole_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "PayrollPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PayrollQuincenaRole" ADD CONSTRAINT "PayrollQuincenaRole_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PayrollQuincenaRole" ADD CONSTRAINT "PayrollQuincenaRole_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PayrollLineItem" ADD CONSTRAINT "PayrollLineItem_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "PayrollQuincenaRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MonthlyLegalRole" ADD CONSTRAINT "MonthlyLegalRole_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MonthlyLegalRole" ADD CONSTRAINT "MonthlyLegalRole_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
