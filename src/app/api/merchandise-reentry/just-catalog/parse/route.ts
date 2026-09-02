import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { canManageJustCatalog } from "@/lib/guards";
import { classifyJustCatalogRows, type JustCatalogParsedRow } from "@/lib/justCatalog";

type RawRow = Record<string, unknown>;

function normalizeKey(k: string): string {
  return k
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

// Mismo criterio tolerante que inventory-control/stock-snapshot/parse — el
// export real de Just no tiene una plantilla fija de DAFLOW, así que el
// emparejamiento de columnas es por coincidencia parcial, no igualdad exacta.
function findColumn(keys: string[], substrings: string[]): string | undefined {
  for (const s of substrings) {
    const found = keys.find((k) => normalizeKey(k).includes(s));
    if (found) return found;
  }
  return undefined;
}

export async function POST(req: NextRequest) {
  if (!(await canManageJustCatalog())) {
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

  // El export real de Just no tiene una plantilla fija de encabezados (ej.
  // "productos" en vez de "nombre"/"descripción" — reportado por Daniel
  // 2026-09-02). Si el archivo trae exactamente 2 columnas y una ya se
  // identificó por su encabezado, la otra es la que falta, sea cual sea su
  // nombre — no hace falta que coincida con ninguna lista de palabras.
  if (columnKeys.length === 2) {
    if (codeKey && !nameKey) nameKey = columnKeys.find((k) => k !== codeKey);
    else if (nameKey && !codeKey) codeKey = columnKeys.find((k) => k !== nameKey);
  }

  if (!codeKey || !nameKey) {
    const missing = [!codeKey && "código del producto", !nameKey && "nombre/descripción del producto"].filter(Boolean);
    return NextResponse.json(
      { error: `No se reconocieron estas columnas en el archivo: ${missing.join(", ")}. Columnas encontradas: ${columnKeys.join(", ")}.` },
      { status: 400 }
    );
  }

  const rows: JustCatalogParsedRow[] = [];
  const warnings: string[] = [];
  const seenCodes = new Set<string>();
  for (const raw of rawRows) {
    const code = String(raw[codeKey] ?? "").trim();
    const name = String(raw[nameKey] ?? "").trim();
    if (!code && !name) continue; // fila vacía
    if (!code || !name) {
      warnings.push(`Fila con código o nombre vacío (código: "${code}", nombre: "${name}") — se ignora.`);
      continue;
    }
    if (seenCodes.has(code)) {
      warnings.push(`El código ${code} aparece repetido dentro del mismo archivo — se usa la primera aparición.`);
      continue;
    }
    seenCodes.add(code);
    rows.push({ code, name });
  }

  if (rows.length === 0) return NextResponse.json({ error: "No se encontró ninguna fila válida en el archivo." }, { status: 400 });

  const preview = await classifyJustCatalogRows(rows);
  return NextResponse.json({ preview, warnings });
}
