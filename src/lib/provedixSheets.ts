import { unstable_cache } from "next/cache";

// Hojas de Google donde el equipo sube el material de cada producto (pedido
// del usuario 2026-10-14): enlace de creativos (Drive), landing con IA,
// descripción y el "Top 10 de esta semana". Michelle las usa para darle al
// dropshipper sus creativos con un botón.
//
// La columna "COSTO REFERENCIAL" se IGNORA a propósito: el precio nunca lo da
// Michelle, el dropshipper lo ve en Dropi (botón "Ver precio en Dropi").
// Se leen como CSV público cada hora.

const SHEETS = [
  "https://docs.google.com/spreadsheets/d/1_B7-4XDGabH8UkL1dE5lo_oPFREmzDKAffgfJRnLRPw/export?format=csv&gid=0",
  "https://docs.google.com/spreadsheets/d/1TrZRjyttpd8BaQoWtxz775hEB4Vu-iZMT8yCT2wtkJA/export?format=csv&gid=0",
];

export type SheetProduct = {
  code: string;
  name: string;
  creatives: string | null;
  landing: string | null;
  description: string | null;
  top10: boolean;
};

function parseCsv(t: string): string[][] {
  const rows: string[][] = [];
  let r: string[] = [];
  let f = "";
  let q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          f += '"';
          i++;
        } else q = false;
      } else f += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      r.push(f);
      f = "";
    } else if (c === "\n") {
      r.push(f);
      rows.push(r);
      r = [];
      f = "";
    } else if (c !== "\r") f += c;
  }
  if (f || r.length) {
    r.push(f);
    rows.push(r);
  }
  return rows;
}

const driveUrl = (s: string | undefined) => {
  const u = (s ?? "").trim();
  return /^https:\/\/(drive|docs)\.google\.com\//.test(u) ? u : null;
};

function readSheet(csv: string): SheetProduct[] {
  const out: SheetProduct[] = [];
  let col: Record<string, number> | null = null;
  let top10 = false;
  for (const row of parseCsv(csv)) {
    const text = row.join(" ");
    if (/TOP 10/i.test(text)) top10 = true;
    else if (/PRODUCTOS EN TENDENCIA/i.test(text)) top10 = false;
    const idIdx = row.findIndex((c) => /^\s*ID DROPI\s*$/i.test(c));
    if (idIdx >= 0) {
      col = {};
      row.forEach((c, i) => {
        const h = c.trim().toUpperCase();
        if (h === "ID DROPI") col!.id = i;
        else if (h.startsWith("NOMBRE")) col!.name = i;
        else if (h === "LINK DE CREATIVOS") col!.creatives = i;
        else if (h.startsWith("LINK DE LANDING")) col!.landing = i;
        else if (h.startsWith("DESCRIPCI")) col!.description = i;
      });
      continue;
    }
    if (!col) continue;
    const code = (row[col.id] ?? "").trim();
    if (!/^\d{3,8}$/.test(code)) continue;
    out.push({
      code,
      name: (row[col.name] ?? "").trim(),
      creatives: driveUrl(row[col.creatives]),
      landing: driveUrl(row[col.landing]),
      description:
        (row[col.description] ?? "")
          // Las hojas traen "Descricpción:" (mal escrito, con tilde) al inicio;
          // \w no reconoce la "ó", por eso se acepta cualquier letra hasta ":".
          // En algunas celdas viene repetido dos veces.
          .replace(/^(\s*Desc[^\s:]{0,12}:\s*)+/i, "")
          .replace(/\s+/g, " ")
          .trim() || null,
      top10,
    });
  }
  return out;
}

async function load(): Promise<SheetProduct[]> {
  const byCode = new Map<string, SheetProduct>();
  for (const url of SHEETS) {
    try {
      const res = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) continue;
      for (const p of readSheet(await res.text())) {
        const prev = byCode.get(p.code);
        // Repetidos (hay algunos en las hojas): se juntan, gana lo que tenga enlace.
        byCode.set(
          p.code,
          prev
            ? {
                ...prev,
                creatives: prev.creatives ?? p.creatives,
                landing: prev.landing ?? p.landing,
                description: prev.description ?? p.description,
                top10: prev.top10 || p.top10,
              }
            : p,
        );
      }
    } catch (e) {
      console.error("[provedixSheets]", e);
    }
  }
  return [...byCode.values()];
}

export const getSheetProducts = unstable_cache(
  load,
  ["provedix-sheet-products"],
  { revalidate: 3600 },
);
