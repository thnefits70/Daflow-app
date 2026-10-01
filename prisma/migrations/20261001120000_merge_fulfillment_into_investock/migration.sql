-- Fusión de Fulfillment en Inventario → área única "INVESTOCK" (2026-10-01,
-- pedido del usuario). Solo datos, sin cambios de tablas.
--   · Inventario (código INV) pasa a llamarse INVESTOCK y se queda con el KPI
--     semanal "Pedidos despachados / Fill Rate" y todo su historial.
--   · El equipo de Fulfillment pasa a INVESTOCK; Fulfillment queda eliminada
--     (borrado lógico, recuperable desde la papelera).
--   · Daniel Morán: "LÍDER DE INVENTARIOS".
--   · Yair Urgilez: asesor en Análisis de Mercado (ya no líder), con los
--     permisos de asesor: registrar ventas externas y confirmar asesoría en
--     "Mercadería recibida". Sus recordatorios privados lo siguen a MKT.

-- 1) INVESTOCK
UPDATE "Department" SET "name" = 'INVESTOCK', "trackWeeklyMetric" = true WHERE "code" = 'INV';

-- 2) Historial de Fulfillment → INVESTOCK
UPDATE "WeeklyMetricRecord" w SET "deptId" = inv."id"
FROM "Department" inv, "Department" ful
WHERE inv."code" = 'INV' AND ful."code" = 'FUL' AND w."deptId" = ful."id"
  AND NOT EXISTS (SELECT 1 FROM "WeeklyMetricRecord" x WHERE x."deptId" = inv."id" AND x."week" = w."week");

UPDATE "WeeklyReviewRecord" r SET "deptId" = inv."id"
FROM "Department" inv, "Department" ful
WHERE inv."code" = 'INV' AND ful."code" = 'FUL' AND r."deptId" = ful."id";

UPDATE "WeeklyReviewRecord" r SET "involvesDeptId" = inv."id"
FROM "Department" inv, "Department" ful
WHERE inv."code" = 'INV' AND ful."code" = 'FUL' AND r."involvesDeptId" = ful."id";

-- 3) Yair → Análisis de Mercado como asesor (antes de mover al resto del
--    equipo, para que no caiga en INVESTOCK)
UPDATE "PeriodicReminder" p SET "deptId" = mkt."id"
FROM "Department" mkt, "User" u
WHERE mkt."code" = 'MKT' AND u."username" = 'yairurgilez' AND p."createdById" = u."id";

UPDATE "User" u SET
  "deptId" = mkt."id",
  "isLeader" = false,
  "leadsDeptId" = NULL,
  "position" = 'ASESOR',
  "canDeclareExternalSales" = true,
  "externalSaleContraEntrega" = false,
  "canConfirmMarketingAdvisor" = true,
  "canViewMarketingArrivalsForDispatch" = false,
  "marketingAdvisorBrand" = 'Importadora Shanghai y Rocket',
  "defaultWorkspaceTab" = NULL
FROM "Department" mkt
WHERE mkt."code" = 'MKT' AND u."username" = 'yairurgilez';

UPDATE "PayrollProfile" pp SET "canLogOvertimeHours" = false
FROM "User" u
WHERE u."username" = 'yairurgilez' AND pp."userId" = u."id";

-- 4) Resto de Fulfillment → INVESTOCK
UPDATE "User" u SET
  "deptId" = inv."id",
  "position" = CASE WHEN u."position" = 'AUXILIAR DE FULFILMENT' THEN 'AUXILIAR DE INVENTARIO' ELSE u."position" END
FROM "Department" inv, "Department" ful
WHERE inv."code" = 'INV' AND ful."code" = 'FUL' AND u."deptId" = ful."id";

-- 5) Puestos
UPDATE "Position" p SET "name" = 'LÍDER DE INVENTARIOS'
FROM "Department" inv
WHERE inv."code" = 'INV' AND p."deptId" = inv."id" AND p."name" = 'LIDER DE INVENTARIO';

INSERT INTO "Position" ("id", "deptId", "name")
SELECT 'pos_' || md5(random()::text || clock_timestamp()::text), mkt."id", 'ASESOR'
FROM "Department" mkt
WHERE mkt."code" = 'MKT'
  AND NOT EXISTS (SELECT 1 FROM "Position" x WHERE x."deptId" = mkt."id" AND x."name" = 'ASESOR');

UPDATE "User" u SET "position" = 'LÍDER DE INVENTARIOS'
FROM "Department" inv
WHERE inv."code" = 'INV' AND u."isLeader" = true AND u."leadsDeptId" = inv."id";

-- 6) Fulfillment eliminada (borrado lógico)
UPDATE "Department" SET "deletedAt" = NOW(), "trackWeeklyMetric" = false, "trackWeeklyReview" = false
WHERE "code" = 'FUL' AND "deletedAt" IS NULL;
