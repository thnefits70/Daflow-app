-- Guarda un resumen de cómo se calculó una línea automática (por ahora solo
-- horas extra), para que se pueda verificar a simple vista que el sistema
-- calculó tal como se pidió. Opcional — solo se llena en líneas con fórmula.
ALTER TABLE "PayrollLineItem" ADD COLUMN "note" TEXT;
