import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { canManageInventoryControl } from "@/lib/guards";
import { getFinanzasDeptId, recentInventorySnapshotPeriods } from "@/lib/inventoryKpis";
import { prisma } from "@/lib/prisma";

const PERIOD_REGEX = /^\d{4}-(0[1-9]|1[0-2])-W[1-4]$/;

type RawRow = Record<string, unknown>;

function normalizeKey(k: string): string {
  return k
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^\x00-\x7F]/g, "") // quita marcas de acento que quedan sueltas tras NFD
    .replace(/[^a-z0-9]/g, "");
}

function num(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

// El reporte real de Provedix ("saldos costeados y valorizados") no tiene una
// plantilla fija de DAFLOW (a diferencia de finance-kpis) — el nombre exacto
// de cada columna puede variar entre exportaciones (confirmado 2026-08-05: el
// export real trae "codigproducto", sin la "o" de "código", no
// "codigoproducto" como se asumió al ver la primera captura). Por eso el
// emparejamiento es por coincidencia parcial sobre la clave normalizada
// (minúsculas, sin acentos/espacios), no por igualdad exacta.
function findColumn(keys: string[], substrings: string[]): string | undefined {
  for (const s of substrings) {
    const found = keys.find((k) => normalizeKey(k).includes(s));
    if (found) return found;
  }
  return undefined;
}

export async function POST(req: NextRequest) {
  if (!(await canManageInventoryControl())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const period = body?.period as string | undefined;
  const fileUrl = body?.fileUrl as string | undefined;
  const fileName = body?.fileName as string | undefined;

  if (!period || !PERIOD_REGEX.test(period)) {
    return NextResponse.json({ error: "Formato de semana inválido." }, { status: 400 });
  }
  if (!recentInventorySnapshotPeriods().includes(period)) {
    return NextResponse.json({ error: "Esa semana no está disponible para cargar." }, { status: 400 });
  }
  if (!fileUrl || !fileName) {
    return NextResponse.json({ error: "No se recibió ningún archivo." }, { status: 400 });
  }

  const deptId = await getFinanzasDeptId();
  if (!deptId) return NextResponse.json({ error: "No se encontró el departamento de Finanzas." }, { status: 500 });

  const fileRes = await fetch(fileUrl);
  if (!fileRes.ok) {
    return NextResponse.json({ error: "No se pudo leer el archivo subido." }, { status: 400 });
  }
  const bytes = new Uint8Array(await fileRes.arrayBuffer());

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(bytes, { type: "buffer" });
  } catch {
    return NextResponse.json({ error: "No se pudo leer el archivo. ¿Es un .xlsx o .xls válido?" }, { status: 400 });
  }

  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : null;
  if (!sheet) {
    return NextResponse.json({ error: "El archivo no tiene ninguna hoja con datos." }, { status: 400 });
  }

  const rawRows = XLSX.utils.sheet_to_json<RawRow>(sheet, { defval: "" });
  const warnings: string[] = [];
  const rows: { productCode: string; description: string; avgCost: number; stock: number; costTotal: number }[] = [];

  if (rawRows.length === 0) {
    return NextResponse.json({ error: "El archivo no tiene filas de datos." }, { status: 400 });
  }

  const columnKeys = Object.keys(rawRows[0]);
  const codeKey = findColumn(columnKeys, ["codig"]);
  const descKey = findColumn(columnKeys, ["descripcion"]);
  const costKey = findColumn(columnKeys, ["costo"]);
  const stockKey = findColumn(columnKeys, ["stock"]);

  if (!codeKey || !descKey || !costKey || !stockKey) {
    const missing = [
      !codeKey && "código de producto",
      !descKey && "descripción",
      !costKey && "costo promedio",
      !stockKey && "stock actual",
    ].filter(Boolean);
    return NextResponse.json(
      { error: `No se reconocieron estas columnas en el archivo: ${missing.join(", ")}. Columnas encontradas: ${columnKeys.join(", ")}.` },
      { status: 400 }
    );
  }

  for (const raw of rawRows) {
    const productCode = String(raw[codeKey] ?? "").trim();
    if (!productCode) continue; // fila vacía o de totales al final del reporte

    const description = String(raw[descKey] ?? "").trim();
    const avgCost = num(raw[costKey]);
    const stock = num(raw[stockKey]);

    if (avgCost === null || stock === null) {
      warnings.push(`${productCode}: faltan costo promedio o stock actual — se ignora esta fila.`);
      continue;
    }

    rows.push({ productCode, description, avgCost, stock, costTotal: avgCost * stock });
  }

  if (rows.length === 0) {
    warnings.push("No se encontró ninguna fila válida en el archivo.");
  }

  const previousSnapshot = await prisma.inventoryProductSnapshot.findFirst({
    where: { deptId, period: { lt: period } },
    orderBy: { period: "desc" },
    select: { period: true },
  });
  const previousPeriod = previousSnapshot?.period ?? null;

  let previousByCode = new Map<string, number>();
  if (previousPeriod) {
    const prevRows = await prisma.inventoryProductSnapshot.findMany({
      where: { deptId, period: previousPeriod },
      select: { productCode: true, stock: true },
    });
    previousByCode = new Map(prevRows.map((r) => [r.productCode, r.stock]));
  }

  const preview = {
    period,
    previousPeriod,
    rows: rows.map((r) => {
      const prevStock = previousByCode.get(r.productCode) ?? null;
      return { ...r, previousStock: prevStock, decreased: prevStock === null ? null : r.stock < prevStock };
    }),
  };

  return NextResponse.json({ preview, warnings, fileUrl, fileName });
}
