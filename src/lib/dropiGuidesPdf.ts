import { getDocumentProxy } from "unpdf";

// Confirmado 2026-09-23, pedido de Yair (Fulfillment) aprobado por el
// usuario: en vez de fotografiar el manifiesto, Yair sube el PDF de guías
// tal como lo imprime Dropi. Ese PDF trae el texto adentro (no es una
// imagen), así que se lee SIN IA y sin costo: por cada transportadora trae
// una tabla resumen "(ID: 177635) - (SKU: X) - Nombre   cantidad" — que ES
// el manifiesto, con el ID real de Dropi — y después una etiqueta por
// pedido, donde viene el color/talla que el resumen no dice.
//
// Cada transportadora imprime la etiqueta distinto (formatos vistos en 6
// PDFs reales de sept 2026):
//   - Servientrega:  "- (147827) Cubre Canas En Barra COLOR: NEGRO X2"
//   - Laar/Veloces:  "(112139)Pistola De Soldar Automatica X1"
//   - Gintracom:     columna CONTENIDO "2.00 * Cubre Canas En Barra CAFE |" (sin ID)
//   - Urbano:        tabla "# PRODUCTO CANT" → "1  Mochila Panalera Con Cambiador Vino  1" (sin ID)
// La cantidad TOTAL de cada producto siempre sale de la tabla resumen (la
// fuente más confiable); las etiquetas solo aportan el desglose por
// variante. Si las etiquetas no alcanzan a cubrir todo el total, lo que
// falta se muestra como "Sin leer en guías" — nunca se inventa una variante.

type PdfItem = { str: string; x: number; y: number; w: number };
type PdfLine = { text: string; items: PdfItem[] };

async function extractPages(bytes: Uint8Array): Promise<PdfLine[][]> {
  // verbosity 0: los PDF de Dropi traen fuentes que pdf.js reporta con
  // miles de advertencias inofensivas ("TT: undefined function").
  const pdf = await getDocumentProxy(bytes, { verbosity: 0 });
  const pages: PdfLine[][] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items: PdfItem[] = [];
    for (const raw of content.items) {
      if (!("str" in raw) || !raw.str.trim()) continue;
      items.push({ str: raw.str, x: raw.transform[4], y: raw.transform[5], w: raw.width });
    }
    // Agrupa por renglón (misma altura, con tolerancia) de arriba hacia abajo.
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const rows: PdfItem[][] = [];
    for (const it of items) {
      const row = rows.find((r) => Math.abs(r[0].y - it.y) <= 2);
      if (row) row.push(it);
      else rows.push([it]);
    }
    rows.sort((a, b) => b[0].y - a[0].y);
    pages.push(rows.map((r) => {
      r.sort((a, b) => a.x - b.x);
      return { text: joinItems(r), items: r };
    }));
    page.cleanup();
  }
  await pdf.cleanup();
  return pages;
}

// Un hueco grande entre dos textos del mismo renglón se marca con doble
// espacio — así "Nombre del producto  12" conserva la separación de columna
// que usa el parser para distinguir el nombre de la cantidad.
function joinItems(items: PdfItem[]): string {
  let out = "";
  let prevEnd: number | null = null;
  for (const it of items) {
    if (prevEnd !== null) {
      const gap = it.x - prevEnd;
      if (gap > 8) out += "  ";
      else if (gap > 0.8 && !out.endsWith(" ") && !it.str.startsWith(" ")) out += " ";
    }
    out += it.str;
    prevEnd = it.x + it.w;
  }
  return out.replace(/[ \t]+$/g, "");
}

export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x00-\x7F]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// "negro" / "NEGRO" / "Negro " → "Negro" — mismo color escrito distinto en
// distintas transportadoras cuenta como una sola variante.
export function tidyVariantLabel(s: string): string {
  const clean = s.replace(/\*+/g, "").replace(/\s+/g, " ").trim();
  const isSize = (p: string) => /^(xs|s|m|l|x+l|\d.*)$/i.test(p);
  return clean
    .toLowerCase()
    .split(" ")
    .map((w) => (w.split(/[/-]/).every(isSize) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

const VARIANT_KEY = /\b(COLOR(?:ES)?|TALLAS?|UNIDAD(?:ES)?|TAMA\S*O|MODELO|SABOR|DISE\S*O|VARIANTE|TONO|CAPACIDAD|MEDIDA)\s*:\s*/i;

function splitVariant(nameWithVariant: string): { name: string; variant: string | null } {
  const m = nameWithVariant.match(VARIANT_KEY);
  if (!m || m.index === undefined) return { name: nameWithVariant.trim(), variant: null };
  const rest = nameWithVariant.slice(m.index + m[0].length).replace(new RegExp(VARIANT_KEY.source, "gi"), "/ ");
  return { name: nameWithVariant.slice(0, m.index).trim(), variant: rest.trim() || null };
}

export type ParsedGuidesLine = {
  code: string;
  name: string;
  quantity: number;
  // Desglose por variante que salió de las etiquetas. Suma ≤ quantity; si
  // falta, el resto se agrega como "Sin leer en guías" al aplicar.
  variants: { label: string; quantity: number }[];
  // Cuántas unidades se alcanzaron a encontrar en las etiquetas (con o sin
  // variante) — solo diagnóstico/aviso.
  labelUnits: number;
};

export type ParsedGuidesPdf = {
  manifestDate: string | null;
  guides: { number: string; carrier: string }[];
  lines: ParsedGuidesLine[];
};

const SUMMARY_RE = /\(ID:\s*(\d+)\)\s*-\s*\(SKU:[^)]*\)\s*-\s*(.+?)\s+(\d+)\s*$/;
const GUIDE_RE = /Nro:\s*\d+\s+Guia:\s*([A-Z0-9-]+)/i;
const CARRIER_RE = /TRANSPORTADORA:\s*([A-Z0-9 ]+?)\s*$/i;
const DATE_RE = /FECHA MANIFIESTO \(DD\/MM\/YYYY\):\s*(\d{2})-(\d{2})-(\d{4})/;
// Greedy a propósito: "(103511)CUATRO ALMOHADAS X4 X1" → la cantidad es el
// ÚLTIMO "X<n>", no el "X4" que es parte del nombre.
const ID_LABEL_RE = /(?:^|\s|-)\((\d{3,})\)\s*(.+)\s+X\s?(\d+)\b/;
const GINTRA_PART_RE = /^(\d+)(?:[.,]\d+)?\s*\*\s*(.+)$/;
const URBANO_ROW_RE = /^\s*\d{1,2}\s{2,}(.+?)\s{2,}(\d+)\s*$/;

// Nombres del resumen de Dropi vienen cortados a ~40 caracteres: si el
// nombre ya viene cortado, lo que sigue en la etiqueta es el resto del
// nombre, no una variante.
const SUMMARY_NAME_CUT = 38;

export async function parseDropiGuidesPdf(bytes: Uint8Array): Promise<ParsedGuidesPdf> {
  const pages = await extractPages(bytes);

  let manifestDate: string | null = null;
  let carrier = "";
  const guides = new Map<string, string>();
  const summary = new Map<string, { name: string; quantity: number }>();
  const byLabel = new Map<string, Map<string, number>>(); // code → variant ("" = sin variante) → unidades

  const addLabel = (code: string, variant: string | null, qty: number) => {
    let m = byLabel.get(code);
    if (!m) byLabel.set(code, (m = new Map()));
    const key = variant ? tidyVariantLabel(variant) : "";
    m.set(key, (m.get(key) ?? 0) + qty);
  };

  // Primera pasada: resumen + guías (las etiquetas sin ID se identifican
  // contra los nombres del resumen, así que tiene que existir completo antes).
  for (const lines of pages) {
    for (const l of lines) {
      const c = l.text.match(CARRIER_RE);
      if (c) carrier = c[1].trim().toUpperCase();
      const d = l.text.match(DATE_RE);
      if (d && !manifestDate) manifestDate = `${d[3]}-${d[2]}-${d[1]}`;
      const g = l.text.match(GUIDE_RE);
      if (g) guides.set(g[1].toUpperCase(), carrier);
      const s = l.text.match(SUMMARY_RE);
      if (s) {
        const prev = summary.get(s[1]);
        summary.set(s[1], { name: prev?.name ?? s[2].trim(), quantity: (prev?.quantity ?? 0) + Number(s[3]) });
      }
    }
  }

  const summaryNames = [...summary.entries()].map(([code, v]) => ({ code, norm: normalizeName(v.name), cut: v.name.trim().length >= SUMMARY_NAME_CUT }));
  // Etiqueta sin ID → el producto del resumen cuyo nombre es el prefijo más
  // largo. Lo que sobra (si empieza en palabra nueva) es la variante.
  const matchByName = (raw: string): { code: string; variant: string | null } | null => {
    const truncated = /\.\.\.|…/.test(raw);
    const norm = normalizeName(raw.replace(/\.\.\.|…/g, " "));
    let best: (typeof summaryNames)[number] | null = null;
    for (const s of summaryNames) {
      if (!s.norm) continue;
      const ok = norm === s.norm || norm.startsWith(s.norm + " ") || (truncated && s.norm.startsWith(norm) && norm.length >= 12);
      if (ok && (!best || s.norm.length > best.norm.length)) best = s;
    }
    if (!best) return null;
    const rest = norm.startsWith(best.norm + " ") ? norm.slice(best.norm.length).trim() : "";
    const labeled = splitVariant(raw);
    if (labeled.variant) return { code: best.code, variant: labeled.variant };
    // Gintracom a veces repite el nombre completo del producto después del
    // nombre corto ("NEOCELL Collagen 567g NEOCELL COLLAGEN ... X3") — eso
    // no es una variante.
    const repeatsName = rest && best.norm.split(" ").slice(0, 2).every((w) => rest.includes(w));
    return { code: best.code, variant: rest && !best.cut && !truncated && !repeatsName ? rest : null };
  };

  for (const lines of pages) {
    for (let i = 0; i < lines.length; i++) {
      const text = lines[i].text;
      if (SUMMARY_RE.test(text) || /\(ID:/.test(text)) continue;

      // Servientrega / Laar / Veloces: traen el ID de Dropi.
      const idm = text.match(ID_LABEL_RE);
      if (idm) {
        const { variant } = splitVariant(idm[2]);
        addLabel(idm[1], variant, Number(idm[3]));
        continue;
      }

      // Gintracom: columna derecha "CONTENIDO:" hasta "RECAUDO:".
      const contItem = lines[i].items.find((it) => /^\s*CONTENIDO:\s*$/.test(it.str) || /^CONTENIDO:$/.test(it.str.trim()));
      if (contItem && /DESTINATARIO/i.test(text)) {
        const x0 = contItem.x - 1;
        let buf = "";
        for (let j = i + 1; j < lines.length && j < i + 25; j++) {
          if (/RECAUDO:/i.test(lines[j].text)) break;
          buf += " " + joinItems(lines[j].items.filter((it) => it.x >= x0));
        }
        for (const part of buf.split("|")) {
          const pm = part.trim().match(GINTRA_PART_RE);
          if (!pm) continue;
          const hit = matchByName(pm[2]);
          if (hit) addLabel(hit.code, hit.variant, Number(pm[1]));
        }
        continue;
      }

      // Urbano: tabla "#  PRODUCTO  CANT".
      if (/^#\s+PRODUCTO\s+CANT/i.test(text.trim())) {
        for (let j = i + 1; j < lines.length; j++) {
          const um = lines[j].text.match(URBANO_ROW_RE);
          if (!um) break;
          const hit = matchByName(um[1]);
          if (hit) addLabel(hit.code, hit.variant, Number(um[2]));
          i = j;
        }
      }
    }
  }

  const out: ParsedGuidesLine[] = [];
  for (const [code, s] of summary) {
    const labels = byLabel.get(code);
    const labelUnits = labels ? [...labels.values()].reduce((a, b) => a + b, 0) : 0;
    const variants = labels ? [...labels.entries()].filter(([k]) => k).map(([label, quantity]) => ({ label, quantity })) : [];
    out.push({ code, name: s.name, quantity: s.quantity, variants: variants.sort((a, b) => b.quantity - a.quantity), labelUnits });
  }

  return { manifestDate, guides: [...guides.entries()].map(([number, c]) => ({ number, carrier: c })), lines: out };
}
