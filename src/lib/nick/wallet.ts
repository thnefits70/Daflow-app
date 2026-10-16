import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";

// NICK — cruce de pagos (aprobado 2026-10-16): lee el Excel "Historial de
// cartera" de Dropi (hoja HISTORIAL DE CARTERA: ID, FECHA dd-mm-aaaa hh:mm,
// TIPO, MONTO, MONTO PREVIO, ORDEN ID, NUMERO DE GUIA, DESCRIPCIÓN, …).
// Solo se guardan movimientos de pedidos; retiros de saldo y transferencias
// entre billeteras son del dueño y se ignoran por completo.

export type WalletKind = "PAGO_GUIA" | "INDEMNIZACION" | "COBRO_FLETE_GARANTIA" | "COBRO_RECOLECCION_GARANTIA" | "RECHAZADO" | "OTRO";

export function classifyWallet(description: string): WalletKind | "IGNORAR" {
  const d = description.toUpperCase();
  if (/RETIRO DE SALDO|TRANSFERENCIA DE WALLET/.test(d)) return "IGNORAR";
  if (/GANANCIA EN LA ORDEN COMO PROVEEDOR/.test(d)) return "PAGO_GUIA";
  if (/INDEMNIZACI[OÓ]N/.test(d)) return "INDEMNIZACION";
  if (/COBRO DE FLETE POR ORDEN\s*\(GARANT/.test(d)) return "COBRO_FLETE_GARANTIA";
  if (/RECOLECCI[OÓ]N DE GARANT/.test(d)) return "COBRO_RECOLECCION_GARANTIA";
  if (/CAMBIO DE ESTATUS: RECHAZADO/.test(d)) return "RECHAZADO";
  return "OTRO";
}

// "31-08-2026 13:56" (hora Ecuador) → instante UTC.
function parseDate(v: string): Date | null {
  const m = /^(\d{1,2})-(\d{1,2})-(\d{4})\s+(\d{1,2}):(\d{2})/.exec(v.trim());
  if (!m) return null;
  return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4] + 5, +m[5]));
}

const norm = (s: string) => s.toUpperCase().replace(/[\s*]+/g, "");

export type ParsedWallet = {
  movements: { id: string; at: Date; kind: WalletKind; direction: string; amount: number; orderId: string | null; guideNumber: string | null; description: string }[];
  skipped: number;
  month: string | null;
};

export function parseWalletXlsx(buf: Buffer): ParsedWallet {
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames.find((n) => /CARTERA/i.test(n)) ?? wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: "" });
  const head = (rows[0] ?? []).map((h) => String(h).toUpperCase().trim());
  const col = (re: RegExp) => head.findIndex((h) => re.test(h));
  const c = {
    id: col(/^ID$/),
    date: col(/^FECHA/),
    type: col(/^TIPO/),
    amount: col(/^MONTO$/),
    order: col(/ORDEN/),
    guide: col(/GUIA|GUÍA/),
    desc: col(/DESCRIP/),
  };
  if (c.id < 0 || c.date < 0 || c.amount < 0 || c.desc < 0) throw new Error("El archivo no tiene las columnas del Historial de cartera de Dropi (ID, FECHA, MONTO, DESCRIPCIÓN).");
  const movements: ParsedWallet["movements"] = [];
  let skipped = 0;
  const months = new Map<string, number>();
  for (const r of rows.slice(1)) {
    const id = String(r[c.id] ?? "").trim();
    const at = parseDate(String(r[c.date] ?? ""));
    if (!id || !at) continue;
    const description = String(r[c.desc] ?? "").trim();
    const kind = classifyWallet(description);
    if (kind === "IGNORAR") {
      skipped++;
      continue;
    }
    const month = String(r[c.date]).trim().replace(/^(\d{1,2})-(\d{1,2})-(\d{4}).*/, (_, _d, mo, y) => `${y}-${mo.padStart(2, "0")}`);
    months.set(month, (months.get(month) ?? 0) + 1);
    const order = c.order >= 0 ? String(r[c.order] ?? "").trim() : "";
    const guide = c.guide >= 0 ? norm(String(r[c.guide] ?? "")) : "";
    movements.push({
      id,
      at,
      kind,
      direction: c.type >= 0 ? String(r[c.type] ?? "").toUpperCase().trim() || "ENTRADA" : "ENTRADA",
      amount: Number(String(r[c.amount]).replace(/,/g, "")) || 0,
      orderId: order || null,
      guideNumber: guide || null,
      description: description.slice(0, 300),
    });
  }
  const month = [...months.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return { movements, skipped, month };
}

export async function importWallet(params: { accountId: string; fileName: string; buf: Buffer; uploadedById: string | null }) {
  const parsed = parseWalletXlsx(params.buf);
  if (!parsed.movements.length) throw new Error("El archivo no trae movimientos de pedidos.");
  const upload = await prisma.nickWalletUpload.create({
    data: { accountId: params.accountId, month: parsed.month ?? "?", fileName: params.fileName.slice(0, 200), rows: 0, skipped: parsed.skipped, uploadedById: params.uploadedById },
  });
  let inserted = 0;
  for (let i = 0; i < parsed.movements.length; i += 1000) {
    const r = await prisma.nickWalletMovement.createMany({
      data: parsed.movements.slice(i, i + 1000).map((m) => ({ ...m, uploadId: upload.id, accountId: params.accountId })),
      skipDuplicates: true,
    });
    inserted += r.count;
  }
  await prisma.nickWalletUpload.update({ where: { id: upload.id }, data: { rows: inserted } });
  return { month: parsed.month, inserted, repeated: parsed.movements.length - inserted, skipped: parsed.skipped };
}
