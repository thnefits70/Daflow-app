-- AlterTable
-- El ROI pasa de ser un valor tipeado a mano a calcularse siempre
-- (utilidad neta ÷ costo de ventas) a partir de los campos que ya existen
-- en esta misma fila — se elimina la columna porque ya no aporta nada que
-- no se pueda derivar de ventas/costoVentas/gastos ya guardados.
ALTER TABLE "FinanceKpiRecord" DROP COLUMN "roi";
