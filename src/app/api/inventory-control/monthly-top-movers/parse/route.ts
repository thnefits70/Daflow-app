import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { canManageInventoryControl } from "@/lib/guards";
import { normalize } from "@/lib/justCatalog";
import { prisma } from "@/lib/prisma";

const MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

type RawRow = Record<string, unknown>;

function normalizeKey(k: string): string {
  return k
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function findColumn(keys: string[], substrings: string[]): string | undefined {
  for (const s of substrings) {
    const found = keys.find((k) => normalizeKey(k).includes(s));
    if (found) return found;
  }
  return undefined;
}

function num(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

// Confirmado 2026-09-04: pedido explícito de Daniel — reporte mensual de
// productos con 200+ movimientos ("Código Producto", "Descripción", "Total
// de Movimientos"), verificado contra un archivo real: el código coincide 1
// a 1 con PurchaseCatalogItem.justCode (mismo hallazgo que el Excel semanal
// de stock por SKU). Para lo poco que no matchee por código, cae a nombre
// normalizado exacto antes de darlo por no encontrado — nunca fuzzy/IA acá,
// es un lote chico (~30 filas) que Daniel revisa a simple vista en los
// avisos.
export async function POST(req: NextRequest) {
  if (!(await canManageInventoryControl())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const month = body?.month as string | undefined;
  const fileUrl = body?.fileUrl as string | undefined;
  const fileName = body?.fileName as string | undefined;

  if (!month || !MONTH_REGEX.test(month)) {
    return NextResponse.json({ error: "Formato de mes inválido." }, { status: 400 });
  }
  if (!fileUrl || !fileName) {
    return NextResponse.json({ error: "No se recibió ningún archivo." }, { status: 400 });
  }

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
  if (rawRows.length === 0) {
    return NextResponse.json({ error: "El archivo no tiene filas de datos." }, { status: 400 });
  }

  const columnKeys = Object.keys(rawRows[0]);
  const codeKey = findColumn(columnKeys, ["codig"]);
  const descKey = findColumn(columnKeys, ["descripcion"]);
  const unitsKey = findColumn(columnKeys, ["movimiento", "unidad", "cantidad"]);

  if (!codeKey || !descKey || !unitsKey) {
    const missing = [!codeKey && "código de producto", !descKey && "descripción", !unitsKey && "unidades/movimientos"].filter(Boolean);
    return NextResponse.json(
      { error: `No se reconocieron estas columnas en el archivo: ${missing.join(", ")}. Columnas encontradas: ${columnKeys.join(", ")}.` },
      { status: 400 }
    );
  }

  const catalogItems = await prisma.purchaseCatalogItem.findMany({ select: { id: true, name: true, justCode: true } });
  const byJustCode = new Map(catalogItems.filter((c) => c.justCode).map((c) => [c.justCode as string, c]));
  const byNormalizedName = new Map(catalogItems.map((c) => [normalize(c.name), c]));

  const warnings: string[] = [];
  const rows: { catalogItemId: string; catalogItemName: string; unitsMoved: number }[] = [];

  for (const raw of rawRows) {
    const code = String(raw[codeKey] ?? "").trim();
    const description = String(raw[descKey] ?? "").trim();
    if (!code && !description) continue; // fila vacía
    if (!code) continue; // fila de totales al final del reporte (ej. "TOTAL GENERAL")

    const unitsMoved = num(raw[unitsKey]);
    if (unitsMoved === null) {
      warnings.push(`${description || code}: falta la cantidad de unidades — se ignora esta fila.`);
      continue;
    }

    const match = byJustCode.get(code) ?? byNormalizedName.get(normalize(description));
    if (!match) {
      warnings.push(`${description || code} (código ${code}): no se encontró en Base de datos de productos — se ignora esta fila.`);
      continue;
    }

    rows.push({ catalogItemId: match.id, catalogItemName: match.name, unitsMoved });
  }

  if (rows.length === 0) {
    warnings.push("No se encontró ninguna fila válida en el archivo.");
  }

  const existingCount = await prisma.monthlyTopMoverEntry.count({ where: { month } });

  return NextResponse.json({ preview: { month, rows }, warnings, replacesExisting: existingCount > 0, fileUrl, fileName });
}
