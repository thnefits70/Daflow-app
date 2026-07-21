import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { supabaseAdmin } from "@/lib/supabase";
import { canEditDeptKpis } from "@/lib/guards";

const BUCKET = "daflow-files";
const MAX_BYTES = 15 * 1024 * 1024;
const PERIOD_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

// Column headers exactly as they appear in Plantilla_KPIs_Financieros_DAFLOW.xlsx.
const DATA_SHEET = "Plantilla mensual";
const SHARED_SHEET = "Datos compartidos mensuales";

type RawRow = Record<string, unknown>;

function num(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

async function ensureBucket() {
  const supabase = supabaseAdmin();
  const { data: buckets } = await supabase.storage.listBuckets();
  if (buckets?.some((b) => b.name === BUCKET)) return;
  await supabase.storage.createBucket(BUCKET, { public: true, fileSizeLimit: MAX_BYTES });
}

export async function POST(req: NextRequest) {
  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  const deptId = formData?.get("deptId") as string | null;
  const period = formData?.get("period") as string | null;

  if (!deptId) return NextResponse.json({ error: "Falta deptId." }, { status: 400 });
  if (!(await canEditDeptKpis(deptId))) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }
  if (!period || !PERIOD_REGEX.test(period)) {
    return NextResponse.json({ error: "Formato de mes inválido." }, { status: 400 });
  }
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "No se recibió ningún archivo." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "El archivo es muy pesado (máximo 15 MB)." }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(bytes, { type: "buffer" });
  } catch {
    return NextResponse.json({ error: "No se pudo leer el archivo. ¿Es un .xlsx válido?" }, { status: 400 });
  }

  const dataSheet = workbook.Sheets[DATA_SHEET];
  const sharedSheet = workbook.Sheets[SHARED_SHEET];
  if (!dataSheet) {
    return NextResponse.json({ error: `No se encontró la hoja "${DATA_SHEET}" en el archivo.` }, { status: 400 });
  }

  const activeOperations = await prisma.financeOperation.findMany({
    where: { deptId, isActive: true },
    select: { id: true, name: true },
  });
  const opByName = new Map(activeOperations.map((o) => [o.name.trim().toLowerCase(), o]));

  const dataRows = XLSX.utils.sheet_to_json<RawRow>(dataSheet, { defval: "" });
  const warnings: string[] = [];
  const rows: {
    operationId: string;
    operationName: string;
    ventas: number;
    costoVentas: number;
    gastosVenta: number;
    gastosAdmin: number;
    otrosIngresos: number;
    gastosFinancieros: number;
    otrosGastos: number;
    roi: number | null;
  }[] = [];

  const matchingRows = dataRows.filter((r) => String(r["Mes"] ?? "").trim() === period);
  if (matchingRows.length === 0) {
    warnings.push(`No se encontró ninguna fila para el mes ${period} en "${DATA_SHEET}".`);
  }

  for (const r of matchingRows) {
    const opName = String(r["Operación"] ?? "").trim();
    const op = opByName.get(opName.toLowerCase());
    if (!op) {
      warnings.push(`Fila con Operación "${opName || "(vacía)"}" no coincide con ninguna operación activa — se ignora.`);
      continue;
    }
    const ventas = num(r["Ventas"]);
    const costoVentas = num(r["Costo de ventas"]);
    if (ventas === null || costoVentas === null) {
      warnings.push(`${op.name}: faltan Ventas o Costo de ventas — no se puede calcular el resto sin esto.`);
      continue;
    }
    const gastosVenta = num(r["Gastos de ventas"]) ?? 0;
    const gastosAdmin = num(r["Gastos administrativos"]) ?? 0;
    const otrosIngresos = num(r["Otros ingresos"]) ?? 0;
    const gastosFinancieros = num(r["Gastos financieros"]) ?? 0;
    const otrosGastos = num(r["Otros gastos"]) ?? 0;
    const roi = num(r["ROI del mes (%)"]);

    for (const [label, val] of [
      ["Gastos de ventas", r["Gastos de ventas"]],
      ["Gastos administrativos", r["Gastos administrativos"]],
      ["Otros ingresos", r["Otros ingresos"]],
      ["Gastos financieros", r["Gastos financieros"]],
      ["Otros gastos", r["Otros gastos"]],
    ] as const) {
      if (val === "" || val === undefined || val === null) {
        warnings.push(`${op.name}: "${label}" vino vacío — se guardará como $0.00.`);
      }
    }

    rows.push({
      operationId: op.id,
      operationName: op.name,
      ventas, costoVentas, gastosVenta, gastosAdmin, otrosIngresos, gastosFinancieros, otrosGastos, roi,
    });
  }

  const coveredOps = new Set(rows.map((r) => r.operationName));
  for (const op of activeOperations) {
    if (!coveredOps.has(op.name)) warnings.push(`No se encontró una fila para "${op.name}" en ${period}.`);
  }

  let shared: { inventarioFinal: number | null; cuentasPorCobrar: number | null; cuentasPorPagar: number | null } | null = null;
  if (sharedSheet) {
    const sharedRows = XLSX.utils.sheet_to_json<RawRow>(sharedSheet, { defval: "" });
    const sharedRow = sharedRows.find((r) => String(r["Mes"] ?? "").trim() === period);
    if (sharedRow) {
      shared = {
        inventarioFinal: num(sharedRow["Inventario al cierre del mes"]),
        cuentasPorCobrar: num(sharedRow["Cuentas por cobrar al cierre del mes"]),
        cuentasPorPagar: num(sharedRow["Cuentas por pagar al cierre del mes"]),
      };
    } else {
      warnings.push(`No se encontró el saldo compartido de ${period} en "${SHARED_SHEET}".`);
    }
  }

  // Store the original file for the upload-history audit trail, same bucket/path
  // convention as the generic /api/upload route.
  await ensureBucket();
  const supabase = supabaseAdmin();
  const safeName = file.name.replace(/[^a-z0-9.\-_]/gi, "_");
  const path = `finance-kpis/${crypto.randomUUID()}-${safeName}`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, bytes, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  let fileUrl: string | null = null;
  let fileName: string | null = null;
  if (!uploadError) {
    fileUrl = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    fileName = file.name;
  }

  return NextResponse.json({
    preview: { period, rows, shared },
    warnings,
    fileUrl,
    fileName,
  });
}
