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
    pages.push(
      rows.map((r) => {
        r.sort((a, b) => a.x - b.x);
        return { text: joinItems(r), items: r };
      })
    );
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

// Urbano imprime tildes rotas: "ergonómica" sale "ergonÃ³mica" (UTF-8 leído
// como Latin-1). Se reparan esos pares antes de comparar nombres; si un
// pedazo no es UTF-8 válido, se deja como estaba.
export function fixBrokenAccents(s: string): string {
  if (!/[Â-ô][\u0080-¿]/.test(s)) return s;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  return s.replace(/[Â-ô][\u0080-¿]+/g, (seq) => {
    try {
      return decoder.decode(Uint8Array.from(seq, (ch) => ch.charCodeAt(0)));
    } catch {
      return seq;
    }
  });
}

export function normalizeName(s: string): string {
  return fixBrokenAccents(s)
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

// Variantes de "paquete": Dropi vende un mismo ID madre como "1 Unidad",
// "2 Unidades", "4 Unidades"… y la tabla resumen cuenta PEDIDOS, no
// unidades (ej. real 2026-09-25: Papel Adhesivo 166387, resumen "1",
// etiqueta "4 unidades" = 4 rollos). Devuelve cuántas unidades trae 1 pedido.
export function packSize(variant: string | null | undefined): number | null {
  const m = variant?.trim().match(/^(\d{1,3})\s*(?:unidad(?:es)?|unds?|uds?|u|rollos?|piezas?|pzs?)\.?$/i);
  const n = m ? Number(m[1]) : 0;
  return n >= 1 ? n : null;
}
const packLabel = (n: number) => `Paquete de ${n}`;

function splitVariant(nameWithVariant: string): { name: string; variant: string | null } {
  const m = nameWithVariant.match(VARIANT_KEY);
  if (!m || m.index === undefined) return { name: nameWithVariant.trim(), variant: null };
  const rest = nameWithVariant.slice(m.index + m[0].length).replace(new RegExp(VARIANT_KEY.source, "gi"), "/ ");
  return { name: nameWithVariant.slice(0, m.index).trim(), variant: rest.trim() || null };
}

// "LAARCOURIER"/"LARCOURRIER" → "LAAR", etc. — un solo nombre por
// transportadora en toda la app.
export function normalizeCarrier(raw: string): string {
  const c = raw.toUpperCase().replace(/[^A-Z]/g, "");
  if (c.startsWith("LAAR") || c.startsWith("LARC")) return "LAAR";
  if (c.startsWith("SERVI")) return "SERVIENTREGA";
  if (c.startsWith("GINTRA")) return "GINTRACOM";
  if (c.startsWith("URBANO")) return "URBANO";
  if (c.startsWith("VELOCES")) return "VELOCES";
  return c || "SIN TRANSPORTADORA";
}

export type ParsedGuidesLine = {
  code: string;
  name: string;
  // Total de pedidos NORMALES (sin las garantías, que van aparte).
  quantity: number;
  // Mismo total, repartido por transportadora (VELOCES, URBANO, …).
  byCarrier: Record<string, number>;
  // Desglose por variante que salió de las etiquetas. Suma ≤ quantity; si
  // falta, el resto se agrega como "Sin leer en guías" al aplicar.
  variants: { label: string; quantity: number }[];
  // Cuántas unidades se alcanzaron a encontrar en las etiquetas (con o sin
  // variante) — solo diagnóstico/aviso.
  labelUnits: number;
};

// Confirmado 2026-09-23 con un manifiesto real del usuario: una guía de
// GARANTÍA viene en el mismo PDF con "Tipo de logistica: SIN RECAUDO" (las
// de Servientrega además empiezan con 745…). Sus productos se sacan de la
// etiqueta de ESA guía — Yair después indica si sale completo, solo parte
// del combo o solo una pieza.
export type ParsedWarrantyLine = { guide: string; carrier: string; code: string; name: string; quantity: number; variant: string | null };

export type ParsedGuidesPdf = {
  manifestDate: string | null;
  guides: { number: string; carrier: string; warranty: boolean }[];
  lines: ParsedGuidesLine[];
  warranty: ParsedWarrantyLine[];
  // Guías de garantía cuya etiqueta no se pudo leer — se avisa, nunca se
  // adivina qué producto era.
  unreadWarrantyGuides: string[];
  // Garantías marcadas solo por "SIN RECAUDO" en transportadoras de las que
  // todavía no tenemos ejemplo — podrían ser pago anticipado; Yair decide.
  uncertainWarrantyGuides: string[];
  // Confirmado 2026-09-25, pedido del usuario: todo lo que la app no pudo
  // leer bien se le explica a Yair en la misma pantalla (y queda guardado)
  // para ir ajustando la lectura en el camino.
  warnings: string[];
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

type LabelHit = { code: string; variant: string | null; qty: number; page: number; line: number };

// ---- Rocket ---------------------------------------------------------------

// Confirmado 2026-09-25 con el PDF real de Yair (etiquetas_*.pdf): Rocket
// entrega sus etiquetas con el mismo formato de Servientrega/Gintracom, pero
// SIN la tabla resumen de Dropi — cada etiqueta trae su guía y
// "PRODUCTOS: (14599) Spray Dispensador De Aceite x 1" con el ID de ROCKET
// (no el de Dropi). La transportadora no viene escrita: se reconoce por el
// formato del número de guía. El usuario decidió que Yair solo suba este PDF
// (ya no el Excel de picking).
export function carrierFromGuide(guide: string): string {
  const g = guide.toUpperCase();
  if (/^D\d{6,}$/.test(g)) return "GINTRACOM";
  // Gintracom de Rocket (confirmado 2026-09-25 con etiqueta real: RKT000032606).
  if (/^RKT\d+$/.test(g)) return "GINTRACOM";
  if (/^LC\d+$/.test(g)) return "LAAR";
  if (/^WYB\d+$/.test(g)) return "URBANO";
  if (/^V\d{6,}$/.test(g)) return "VELOCES";
  if (/^\d{9}$/.test(g)) return "SERVIENTREGA";
  return "SIN TRANSPORTADORA";
}

// Los códigos de Rocket se guardan con prefijo "R" para que nunca choquen
// con un ID de Dropi que tenga los mismos números.
export const ROCKET_PREFIX = "R";
export const isRocketCode = (code: string) => code.startsWith(ROCKET_PREFIX);

const ROCKET_PRODUCT_RE = /^\s*\((\d{2,})\)\s*(.+?)\s+x\s*(\d+)\s*$/i;
const BARCODE_GUIDE_RE = /\*([A-Z]{0,3}\d{6,})\*/;

// Etiqueta de Gintracom de Rocket (guía RKT…): NO trae el ID del producto,
// solo "1 * Smartwatch Ultramax T1000" en la columna CONTENIDO. Se reconoce
// por nombre contra los productos de Rocket que sí traen ID (en el mismo PDF
// o ya vinculados antes); si no, queda como código "RN:<nombre>" y Yair lo
// vincula una vez, igual que cualquier código nuevo.
export const ROCKET_NAME_PREFIX = `${ROCKET_PREFIX}N:`;
export function rocketNameCode(name: string): string {
  return `${ROCKET_NAME_PREFIX}${normalizeName(name).slice(0, 60)}`;
}

function gintracomRocketLabel(lines: PdfLine[]): { guide: string; products: { name: string; qty: number }[] } | null {
  const text = lines.map((l) => l.text).join("\n");
  const g = text.match(/GUIA\s+GINTRACOM\s*#?\s*\n?\s*([A-Z]{0,3}\d{6,})/i);
  if (!g) return null;
  const products: { name: string; qty: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const contItem = lines[i].items.find((it) => it.str.trim() === "CONTENIDO:");
    if (!contItem) continue;
    const x0 = contItem.x - 1;
    let buf = "";
    for (let j = i + 1; j < lines.length && j < i + 25; j++) {
      if (/RECAUDO:/i.test(lines[j].text)) break;
      buf += " " + joinItems(lines[j].items.filter((it) => it.x >= x0));
    }
    for (const part of buf.split("|")) {
      const pm = part.trim().match(GINTRA_PART_RE);
      if (pm) products.push({ name: pm[2].trim(), qty: Number(pm[1]) });
    }
    break;
  }
  return { guide: g[1].toUpperCase(), products };
}

function parseRocketPages(pages: PdfLine[][]): ParsedGuidesPdf {
  const guides = new Map<string, { carrier: string; warranty: boolean }>();
  const normal = new Map<string, { name: string; byCarrier: Map<string, number>; variants: Map<string, number>; labeled: number }>();
  const warranty: ParsedWarrantyLine[] = [];
  let manifestDate: string | null = null;

  // Nombres de Rocket que sí traen ID en este PDF — para reconocer las
  // etiquetas de Gintracom (que no traen ID).
  const idByName = new Map<string, string>();
  for (const lines of pages) {
    for (const l of lines) {
      const m = l.text.match(ROCKET_PRODUCT_RE);
      if (m) idByName.set(normalizeName(splitVariant(m[2]).name), `${ROCKET_PREFIX}${m[1]}`);
    }
  }

  const add = (code: string, rawName: string, orders: number, guide: string, carrier: string, isWarranty: boolean) => {
    const { name, variant: rawVariant } = splitVariant(rawName);
    const n = packSize(rawVariant ? tidyVariantLabel(rawVariant) : null);
    const qty = orders * (n ?? 1);
    const variant = n ? packLabel(n) : rawVariant;
    if (isWarranty) {
      warranty.push({ guide, carrier, code, name, quantity: qty, variant: variant ? tidyVariantLabel(variant) : null });
      return;
    }
    let row = normal.get(code);
    if (!row) normal.set(code, (row = { name, byCarrier: new Map(), variants: new Map(), labeled: 0 }));
    row.byCarrier.set(carrier, (row.byCarrier.get(carrier) ?? 0) + qty);
    row.labeled += qty;
    if (variant) {
      const key = tidyVariantLabel(variant);
      row.variants.set(key, (row.variants.get(key) ?? 0) + qty);
    }
  };

  const warnings: string[] = [];
  const pagesWithoutGuide: number[] = [];
  const guidesWithoutProducts: string[] = [];
  // Rocket todavía no ha mandado ninguna garantía (confirmado 2026-09-25):
  // "SIN RECAUDO" se toma como posible garantía y Yair confirma. Una
  // etiqueta sin bloque de RECAUDO es PAGO ANTICIPADO (el cliente ya pagó),
  // no garantía — sale como pedido normal.
  const uncertain = new Set<string>();

  for (const [pageIdx, lines] of pages.entries()) {
    const text = lines.map((l) => l.text).join("\n");
    const isWarranty = /SIN\s+RECAUDO/i.test(text);

    const gin = gintracomRocketLabel(lines);
    if (gin) {
      if (isWarranty) uncertain.add(gin.guide);
      if (gin.products.length === 0) guidesWithoutProducts.push(gin.guide);
      guides.set(gin.guide, { carrier: carrierFromGuide(gin.guide), warranty: isWarranty });
      for (const p of gin.products) {
        const known = idByName.get(normalizeName(splitVariant(p.name).name));
        add(known ?? rocketNameCode(splitVariant(p.name).name), p.name, p.qty, gin.guide, carrierFromGuide(gin.guide), isWarranty);
      }
      continue;
    }

    const g = text.match(BARCODE_GUIDE_RE);
    if (!g) {
      if (text.trim()) pagesWithoutGuide.push(pageIdx + 1);
      continue;
    }
    const guide = g[1].toUpperCase();
    const carrier = carrierFromGuide(guide);
    guides.set(guide, { carrier, warranty: isWarranty });
    if (isWarranty) uncertain.add(guide);
    let productsHere = 0;
    const d = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s*\|/);
    if (d && !manifestDate) manifestDate = `${d[3]}-${d[1].padStart(2, "0")}-${d[2].padStart(2, "0")}`;

    let inProducts = false;
    for (const l of lines) {
      if (/PRODUCTOS:/i.test(l.text)) {
        inProducts = true;
        continue;
      }
      if (!inProducts) continue;
      const m = l.text.match(ROCKET_PRODUCT_RE);
      if (!m) continue;
      add(`${ROCKET_PREFIX}${m[1]}`, m[2], Number(m[3]), guide, carrier, isWarranty);
      productsHere++;
    }
    if (productsHere === 0) guidesWithoutProducts.push(guide);
  }

  if (pagesWithoutGuide.length > 0) {
    warnings.push(`En ${pagesWithoutGuide.length} página(s) no encontré el número de guía (página ${pagesWithoutGuide.slice(0, 5).join(", ")}) — esas etiquetas no se sumaron.`);
  }
  if (guidesWithoutProducts.length > 0) {
    warnings.push(`En ${guidesWithoutProducts.length} guía(s) no pude leer los productos (ej. ${guidesWithoutProducts.slice(0, 3).join(", ")}) — no se sumaron.`);
  }
  const noCarrier = [...guides.entries()].filter(([, v]) => v.carrier === "SIN TRANSPORTADORA").map(([n]) => n);
  if (noCarrier.length > 0) {
    warnings.push(`No reconocí la transportadora de ${noCarrier.length} guía(s) por su número (ej. ${noCarrier.slice(0, 3).join(", ")}).`);
  }

  const lines: ParsedGuidesLine[] = [...normal.entries()].map(([code, r]) => ({
    code,
    name: r.name,
    quantity: r.labeled,
    byCarrier: Object.fromEntries(r.byCarrier),
    variants: [...r.variants.entries()].map(([label, quantity]) => ({ label, quantity })).sort((a, b) => b.quantity - a.quantity),
    labelUnits: r.labeled,
  }));
  return {
    manifestDate,
    guides: [...guides.entries()].map(([number, v]) => ({ number, carrier: v.carrier, warranty: v.warranty })),
    lines,
    warranty,
    unreadWarrantyGuides: [...guides.entries()].filter(([n, v]) => v.warranty && !warranty.some((w) => w.guide === n)).map(([n]) => n),
    uncertainWarrantyGuides: [...uncertain],
    warnings,
  };
}

// Punto de entrada único: reconoce solo si el PDF es de Dropi (trae la
// tabla resumen "(ID: …) - (SKU: …)") o de Rocket (etiquetas "ROC." /
// "ROCKET ECOMFULLFILMENT"), y lo lee con el formato que corresponde.
export async function parseGuidesPdf(bytes: Uint8Array): Promise<ParsedGuidesPdf & { source: "DROPI" | "ROCKET" }> {
  const pages = await extractPages(bytes);
  const hasDropiSummary = pages.some((lines) => lines.some((l) => SUMMARY_RE.test(l.text)));
  const looksRocket = pages.some((lines) => lines.some((l) => /ROCKET ECOMFULLFILMENT|\bROC\.[a-z]/i.test(l.text)));
  if (!hasDropiSummary && looksRocket) return { ...parseRocketPages(pages), source: "ROCKET" };
  return { ...parseDropiPages(pages), source: "DROPI" };
}

export async function parseDropiGuidesPdf(bytes: Uint8Array): Promise<ParsedGuidesPdf> {
  return parseDropiPages(await extractPages(bytes));
}

function parseDropiPages(pages: PdfLine[][]): ParsedGuidesPdf {

  let manifestDate: string | null = null;
  let carrier = "";
  const guides = new Map<string, { carrier: string; warranty: boolean; sinRecaudo: boolean }>();
  // code → transportadora → unidades (tal como la tabla resumen, garantías incluidas)
  const summary = new Map<string, { name: string; byCarrier: Map<string, number> }>();

  // Primera pasada: resumen + guías (las etiquetas sin ID se identifican
  // contra los nombres del resumen, así que tiene que existir completo antes).
  for (const lines of pages) {
    for (const l of lines) {
      const c = l.text.match(CARRIER_RE);
      if (c) carrier = normalizeCarrier(c[1]);
      const d = l.text.match(DATE_RE);
      if (d && !manifestDate) manifestDate = `${d[3]}-${d[2]}-${d[1]}`;
      const g = l.text.match(GUIDE_RE);
      if (g) guides.set(g[1].toUpperCase(), { carrier, warranty: false, sinRecaudo: /SIN\s+RECAUDO/i.test(l.text) });
      const s = l.text.match(SUMMARY_RE);
      if (s) {
        let row = summary.get(s[1]);
        if (!row) summary.set(s[1], (row = { name: s[2].trim(), byCarrier: new Map() }));
        row.byCarrier.set(carrier, (row.byCarrier.get(carrier) ?? 0) + Number(s[3]));
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

  const hits: LabelHit[] = [];
  // Dónde aparece cada número de guía FUERA de la tabla resumen — sirve
  // para saber a qué guía pertenece cada etiqueta (se usa para separar las
  // garantías). Servientrega/Laar/Urbano/Veloces imprimen el número antes
  // del producto; Gintracom después — por eso se toma la aparición más
  // cercana en la misma página, hacia arriba o hacia abajo.
  const guideSpots: { guide: string; page: number; line: number }[] = [];
  const guideTokens = [...guides.keys()];
  // Veloces imprime en la etiqueta "Esta orden de garantia se genero a
  // través de la guia original #…" (ejemplo real 2026-09-25).
  const garantiaSpots: { page: number; line: number }[] = [];

  pages.forEach((lines, p) => {
    for (let i = 0; i < lines.length; i++) {
      const text = lines[i].text;
      if (GUIDE_RE.test(text)) continue;
      const compact = text.replace(/[\s*]/g, "").toUpperCase();
      for (const g of guideTokens) if (compact.includes(g)) guideSpots.push({ guide: g, page: p, line: i });
      if (/orden\s+de\s+garant/i.test(text)) garantiaSpots.push({ page: p, line: i });
      if (SUMMARY_RE.test(text) || /\(ID:/.test(text)) continue;

      // Servientrega / Laar / Veloces: traen el ID de Dropi.
      const idm = text.match(ID_LABEL_RE);
      if (idm) {
        const { variant } = splitVariant(idm[2]);
        // La etiqueta a veces trae el ID de la VARIANTE y el resumen el del
        // producto madre (ej. real 2026-09-25: resumen 127946, etiqueta
        // "(143623) Reloj Smartwatch T500 Color: Hombre"). Si el ID no está
        // en el resumen, se reconoce por nombre para no perder la variante.
        const code = summary.has(idm[1]) ? idm[1] : (matchByName(idm[2])?.code ?? idm[1]);
        hits.push({ code, variant, qty: Number(idm[3]), page: p, line: i });
        continue;
      }

      // Gintracom: columna derecha "CONTENIDO:" hasta "RECAUDO:".
      const contItem = lines[i].items.find((it) => it.str.trim() === "CONTENIDO:");
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
          if (hit) hits.push({ code: hit.code, variant: hit.variant, qty: Number(pm[1]), page: p, line: i });
        }
        continue;
      }

      // Urbano: tabla "#  PRODUCTO  CANT".
      if (/^#\s+PRODUCTO\s+CANT/i.test(text.trim())) {
        for (let j = i + 1; j < lines.length; j++) {
          const um = lines[j].text.match(URBANO_ROW_RE);
          if (!um) break;
          const hit = matchByName(fixBrokenAccents(um[1]));
          if (hit) hits.push({ code: hit.code, variant: hit.variant, qty: Number(um[2]), page: p, line: j });
          i = j;
        }
      }
    }
  });

  const guideOf = (h: LabelHit): string | null => {
    let best: { guide: string; dist: number } | null = null;
    for (const s of guideSpots) {
      if (s.page !== h.page) continue;
      const dist = Math.abs(s.line - h.line);
      if (!best || dist < best.dist) best = { guide: s.guide, dist };
    }
    return best?.guide ?? null;
  };

  // Garantía en Dropi (confirmado con Yair 2026-09-25):
  //   - Veloces: la etiqueta dice "orden de garantía … guía original".
  //   - "SIN RECAUDO" sin esas señales = PAGO ANTICIPADO → pedido normal.
  //   - Servientrega: la guía que empieza con 7 es SIN RECAUDO, pero NO
  //     siempre garantía (corregido 2026-09-25 con ejemplo real: de
  //     745669899/900/903/905 solo 903 era garantía, las otras pago
  //     anticipado, y la etiqueta no las diferencia) → POSIBLE garantía.
  //   - Gintracom/Laar/Urbano: todavía sin ejemplo — "SIN RECAUDO" queda
  //     como POSIBLE garantía y Yair confirma o la pasa a pago anticipado.
  const garantiaGuides = new Set<string>();
  for (const spot of garantiaSpots) {
    const g = guideOf({ code: "", variant: null, qty: 0, page: spot.page, line: spot.line });
    if (g) garantiaGuides.add(g);
  }
  const uncertainWarrantyGuides: string[] = [];
  for (const [n, g] of guides) {
    if (g.carrier === "SERVIENTREGA") {
      g.warranty = n.startsWith("7");
      if (g.warranty) uncertainWarrantyGuides.push(n);
    } else if (garantiaGuides.has(n)) g.warranty = true;
    else if (g.carrier !== "VELOCES" && g.sinRecaudo) {
      g.warranty = true;
      uncertainWarrantyGuides.push(n);
    }
  }
  const warrantyGuides = new Set([...guides.entries()].filter(([, g]) => g.warranty).map(([n]) => n));
  const warranty: ParsedWarrantyLine[] = [];
  const byLabel = new Map<string, Map<string, number>>(); // code → variante ("" = sin variante) → unidades
  const ordersRead = new Map<string, number>(); // code → pedidos leídos en etiquetas
  const packExtra = new Map<string, Map<string, number>>(); // code → transportadora → unidades extra por paquetes
  for (const h of hits) {
    const g = warrantyGuides.size > 0 ? guideOf(h) : null;
    if (g && warrantyGuides.has(g)) {
      warranty.push({
        guide: g,
        carrier: guides.get(g)!.carrier,
        code: h.code,
        name: summary.get(h.code)?.name ?? h.code,
        quantity: h.qty,
        variant: h.variant ? tidyVariantLabel(h.variant) : null,
      });
      continue;
    }
    let m = byLabel.get(h.code);
    if (!m) byLabel.set(h.code, (m = new Map()));
    let key = h.variant ? tidyVariantLabel(h.variant) : "";
    ordersRead.set(h.code, (ordersRead.get(h.code) ?? 0) + h.qty);
    const n = packSize(key);
    if (n) {
      key = packLabel(n);
      // Unidades de más sobre el pedido, en la transportadora de su guía.
      const g = guideOf(h);
      const c = (g && guides.get(g)?.carrier) || "";
      let e = packExtra.get(h.code);
      if (!e) packExtra.set(h.code, (e = new Map()));
      e.set(c, (e.get(c) ?? 0) + h.qty * (n - 1));
    }
    m.set(key, (m.get(key) ?? 0) + h.qty * (n ?? 1));
  }

  const lines: ParsedGuidesLine[] = [];
  const packUnread: { name: string; orders: number }[] = [];
  for (const [code, s] of summary) {
    const byCarrier: Record<string, number> = {};
    for (const [c, q] of s.byCarrier) {
      // La tabla resumen incluye las garantías; se restan porque van aparte.
      const w = warranty.filter((x) => x.code === code && x.carrier === c).reduce((a, x) => a + x.quantity, 0);
      if (q - w > 0) byCarrier[c] = q - w;
    }
    const orders = Object.values(byCarrier).reduce((a, b) => a + b, 0);
    if (orders === 0) continue;
    const extra = packExtra.get(code);
    if (extra) {
      for (const [c, e] of extra) {
        const target = c in byCarrier ? c : Object.entries(byCarrier).sort((a, b) => b[1] - a[1])[0][0];
        byCarrier[target] += e;
      }
      const unreadOrders = orders - (ordersRead.get(code) ?? 0);
      if (unreadOrders > 0) packUnread.push({ name: s.name, orders: unreadOrders });
    }
    const quantity = Object.values(byCarrier).reduce((a, b) => a + b, 0);
    const labels = byLabel.get(code);
    const labelUnits = labels ? [...labels.values()].reduce((a, b) => a + b, 0) : 0;
    const variants = labels ? [...labels.entries()].filter(([k]) => k).map(([label, q]) => ({ label, quantity: q })) : [];
    lines.push({ code, name: s.name, quantity, byCarrier, variants: variants.sort((a, b) => b.quantity - a.quantity), labelUnits });
  }

  // Garantías en paquete: se multiplica DESPUÉS de restarlas del resumen
  // (arriba), porque el resumen cuenta pedidos.
  for (const w of warranty) {
    const n = packSize(w.variant);
    if (!n) continue;
    w.quantity *= n;
    w.variant = packLabel(n);
  }

  const readWarranty = new Set(warranty.map((w) => w.guide));

  const warnings: string[] = [];
  for (const p of packUnread) {
    warnings.push(
      `⚠ ${p.name}: se vende en paquetes (1, 2, 4 unidades…) y no pude leer ${p.orders} etiqueta(s) — cada una se contó como 1 unidad, puede faltar. Revisa esas etiquetas al preparar.`
    );
  }
  const incomplete = lines.filter((l) => l.labelUnits < l.quantity);
  if (incomplete.length > 0) {
    const units = incomplete.reduce((a, l) => a + (l.quantity - l.labelUnits), 0);
    warnings.push(
      `En ${incomplete.length} producto(s) no pude leer todas las etiquetas (${units} unidad(es)) — el total está bien porque sale de la tabla, pero sus colores/tallas pueden salir incompletos. Ej: ${incomplete
        .slice(0, 3)
        .map((l) => l.name)
        .join(", ")}.`
    );
  }
  const noCarrier = [...guides.entries()].filter(([, v]) => !v.carrier || v.carrier === "SIN TRANSPORTADORA").map(([n]) => n);
  if (noCarrier.length > 0) warnings.push(`No reconocí la transportadora de ${noCarrier.length} guía(s) (ej. ${noCarrier.slice(0, 3).join(", ")}).`);

  return {
    manifestDate,
    guides: [...guides.entries()].map(([number, g]) => ({ number, carrier: g.carrier, warranty: g.warranty })),
    lines,
    warranty,
    unreadWarrantyGuides: [...warrantyGuides].filter((g) => !readWarranty.has(g)),
    uncertainWarrantyGuides,
    warnings,
  };
}
