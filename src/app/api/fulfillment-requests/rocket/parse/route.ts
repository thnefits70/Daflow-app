import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { canSubmitFulfillmentRequest } from "@/lib/guards";
import { classifyRocketRows, type RocketParsedRow } from "@/lib/rocketRequest";

type RawRow = Record<string, unknown>;

function normalizeKey(k: string): string {
  return k
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

// Mismo criterio tolerante que just-catalog/parse — el export real de Rocket
// no tiene una plantilla fija de DAFLOW.
function findColumn(keys: string[], substrings: string[]): string | undefined {
  for (const s of substrings) {
    const found = keys.find((k) => normalizeKey(k).includes(s));
    if (found) return found;
  }
  return undefined;
}

export async function POST(req: NextRequest) {
  if (!(await canSubmitFulfillmentRequest())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const fileUrl = body?.fileUrl as string | undefined;
  if (!fileUrl) return NextResponse.json({ error: "No se recibió ningún archivo." }, { status: 400 });

  const fileRes = await fetch(fileUrl);
  if (!fileRes.ok) return NextResponse.json({ error: "No se pudo leer el archivo subido." }, { status: 400 });
  const bytes = new Uint8Array(await fileRes.arrayBuffer());

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(bytes, { type: "buffer" });
  } catch {
    return NextResponse.json({ error: "No se pudo leer el archivo. ¿Es un .xlsx o .xls válido?" }, { status: 400 });
  }

  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : null;
  if (!sheet) return NextResponse.json({ error: "El archivo no tiene ninguna hoja con datos." }, { status: 400 });

  const rawRows = XLSX.utils.sheet_to_json<RawRow>(sheet, { defval: "" });
  if (rawRows.length === 0) return NextResponse.json({ error: "El archivo no tiene filas de datos." }, { status: 400 });

  const columnKeys = Object.keys(rawRows[0]);
  let codeKey = findColumn(columnKeys, ["codigo", "codig", "sku"]);
  let nameKey = findColumn(columnKeys, ["descripcion", "nombre", "producto", "articulo", "detalle"]);
  let qtyKey = findColumn(columnKeys, ["cantidad", "cant", "unidades", "und", "qty"]);

  // Si falta exactamente una columna y solo queda una sin identificar entre
  // las 3, es esa — mismo criterio de tolerancia que just-catalog/parse.
  const missingCols = [!codeKey, !nameKey, !qtyKey].filter(Boolean).length;
  if (missingCols === 1) {
    const remaining = columnKeys.filter((k) => k !== codeKey && k !== nameKey && k !== qtyKey);
    if (remaining.length === 1) {
      if (!codeKey) codeKey = remaining[0];
      else if (!nameKey) nameKey = remaining[0];
      else qtyKey = remaining[0];
    }
  }

  if (!codeKey || !nameKey || !qtyKey) {
    const missing = [!codeKey && "código", !nameKey && "nombre/descripción", !qtyKey && "cantidad"].filter(Boolean);
    return NextResponse.json(
      { error: `No se reconocieron estas columnas en el archivo: ${missing.join(", ")}. Columnas encontradas: ${columnKeys.join(", ")}.` },
      { status: 400 }
    );
  }

  const rows: RocketParsedRow[] = [];
  const warnings: string[] = [];
  const seenCodes = new Set<string>();
  for (const raw of rawRows) {
    const code = String(raw[codeKey] ?? "").trim();
    const name = String(raw[nameKey] ?? "").trim();
    const qtyRaw = String(raw[qtyKey] ?? "").trim();
    if (!code && !name) continue; // fila vacía
    if (!code || !name) {
      warnings.push(`Fila con código o nombre vacío (código: "${code}", nombre: "${name}") — se ignora.`);
      continue;
    }
    const quantity = Math.round(Number(qtyRaw.replace(",", ".")));
    if (!Number.isFinite(quantity) || quantity <= 0) {
      warnings.push(`"${name}" (${code}) tiene una cantidad inválida ("${qtyRaw}") — se ignora.`);
      continue;
    }
    if (seenCodes.has(code)) {
      warnings.push(`El código ${code} aparece repetido dentro del mismo archivo — se suman ambas cantidades.`);
    }
    seenCodes.add(code);
    const existing = rows.find((r) => r.code === code);
    if (existing) existing.quantity += quantity;
    else rows.push({ code, name, quantity });
  }

  if (rows.length === 0) return NextResponse.json({ error: "No se encontró ninguna fila válida en el archivo." }, { status: 400 });

  const preview = await classifyRocketRows(rows);
  return NextResponse.json({ preview, warnings });
}
