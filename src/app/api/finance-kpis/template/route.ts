import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { canEditDeptKpis } from "@/lib/guards";

const PERIOD_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;
const MONTH_NAMES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
function monthLabel(period: string) {
  const [y, m] = period.split("-");
  return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
}

// Always generated live from the current active operaciones — never a
// static file that can drift out of sync with what /api/finance-kpis/parse
// actually expects. Prefilled with the Mes/Operación for whichever period
// the user has selected in "Cargar plantilla", so downloading it right
// before uploading is a real time-saver, not just a reference document.
export async function GET(req: NextRequest) {
  const deptId = req.nextUrl.searchParams.get("deptId");
  const period = req.nextUrl.searchParams.get("period");
  if (!deptId) return NextResponse.json({ error: "Falta deptId." }, { status: 400 });
  if (!period || !PERIOD_REGEX.test(period)) {
    return NextResponse.json({ error: "Formato de mes inválido." }, { status: 400 });
  }
  if (!(await canEditDeptKpis(deptId))) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const operations = await prisma.financeOperation.findMany({
    where: { deptId, isActive: true },
    orderBy: { order: "asc" },
  });
  if (operations.length === 0) {
    return NextResponse.json({ error: "No hay operaciones activas configuradas." }, { status: 400 });
  }

  const dataHeaders = [
    "Mes", "Operación", "Ventas", "Costo de ventas", "Gastos de ventas",
    "Gastos administrativos", "Otros ingresos", "Gastos financieros", "Otros gastos", "ROI del mes (%)",
  ];
  const dataRows = operations.map((op) => [period, op.name, "", "", "", "", "", "", "", ""]);

  const wb = XLSX.utils.book_new();

  const instrRows = [
    [`Plantilla de KPIs financieros — ${monthLabel(period)}`],
    [""],
    ["Cómo llenarla:"],
    [`1. Ya viene una fila por cada operación activa (${operations.map((o) => o.name).join(", ")}) para ${monthLabel(period)}. No mezclar ni sumar las operaciones — DAFLOW las suma solo al activar la vista Consolidado.`],
    ["2. Llenar SOLO estas columnas con números (sin $, sin comas de miles):"],
    ["   Ventas, Costo de ventas, Gastos de ventas, Gastos administrativos, Otros ingresos, Gastos financieros, Otros gastos, ROI del mes (%)."],
    ["3. NO agregues fórmulas ni columnas calculadas — Utilidad bruta, márgenes, utilidad operativa y utilidad neta los calcula DAFLOW automáticamente al subir el archivo."],
    ["4. Hoja 'Datos compartidos mensuales': inventario, cuentas por cobrar y cuentas por pagar al cierre del mes — una sola vez para todas las operaciones (no se reparte por marca)."],
    ["5. Cuando termines, guarda el archivo y súbelo en Finanzas y Contabilidad → KPIs financieros → Cargar plantilla."],
  ];
  const wsInstr = XLSX.utils.aoa_to_sheet(instrRows);
  wsInstr["!cols"] = [{ wch: 105 }];
  XLSX.utils.book_append_sheet(wb, wsInstr, "Instrucciones");

  const wsData = XLSX.utils.aoa_to_sheet([dataHeaders, ...dataRows]);
  wsData["!cols"] = [{ wch: 10 }, { wch: 18 }, { wch: 12 }, { wch: 16 }, { wch: 15 }, { wch: 20 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 15 }];
  wsData["!dataValidation"] = {
    [`B2:B${dataRows.length + 1}`]: { type: "list", formula1: `"${operations.map((o) => o.name).join(",")}"` },
  };
  XLSX.utils.book_append_sheet(wb, wsData, "Plantilla mensual");

  const wsShared = XLSX.utils.aoa_to_sheet([
    ["Mes", "Inventario al cierre del mes", "Cuentas por cobrar al cierre del mes", "Cuentas por pagar al cierre del mes"],
    [period, "", "", ""],
  ]);
  wsShared["!cols"] = [{ wch: 10 }, { wch: 26 }, { wch: 30 }, { wch: 28 }];
  XLSX.utils.book_append_sheet(wb, wsShared, "Datos compartidos mensuales");

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const fileName = `Plantilla_KPIs_DAFLOW_${period}.xlsx`;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
