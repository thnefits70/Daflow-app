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

export type PdfItem = { str: string; x: number; y: number; w: number };
export type PdfLine = { text: string; items: PdfItem[] };

export async function extractPages(bytes: Uint8Array): Promise<PdfLine[][]> {
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

const VARIANT_KEY = /\b(COLOR(?:ES)?|TALLAS?|UNIDAD(?:ES)?|TAMA\S*O|MODELO|SABOR|DISE\S*O|VARIANTE|TONO|CAPACIDAD|MEDIDA|CAJAS?|CANTIDAD)\s*:\s*/i;

// Variantes de "paquete": Dropi vende un mismo ID madre como "1 Unidad",
// "2 Unidades", "4 Unidades"… y la tabla resumen cuenta PEDIDOS, no
// unidades (ej. real 2026-09-25: Papel Adhesivo 166387, resumen "1",
// etiqueta "4 unidades" = 4 rollos). Devuelve cuántas unidades trae 1 pedido.
// "2UNID" (Gintracom, Almohada ergonómica 127053, 2026-09-25) no se
// reconocía y cada pedido contaba 1 en vez de 2.
// "CAJAS: 2 Cajas 4 Radios" (Servientrega, Radio Baofeng 110339,
// 2026-09-26): se cuentan CAJAS, que es lo que cuenta Inventario; "4 Radios"
// solo describe lo que trae. Antes contaba 1 por pedido (11 en vez de 17).
export function packSize(variant: string | null | undefined): number | null {
  const m = variant?.trim().match(/^(\d{1,3})\s*(?:unid(?:ad(?:es)?|s)?|unds?|uds?|u|rollos?|piezas?|pzs?|cajas?)\.?(?:\s+\d{1,3}\s+[a-záéíóúñ]+)?$/i);
  const n = m ? Number(m[1]) : 0;
  return n >= 1 ? n : null;
}
const packLabel = (n: number) => `Paquete de ${n}`;

// Variante que repite el nombre del producto + "X<n>" = paquete de n
// (pedido de Daniel 2026-10-02, NEOCELL 146702: en Dropi el mismo ID trae
// "567g", "567g X2" y "567g X3"). Servientrega/Laar: "NEOCELL … 567g
// CANTIDAD: NEOCELL … 567g X3  X1"; Gintracom: "1.00 * NEOCELL … 567g
// NEOCELL … 567g X3". Sin "X<n>" es 1 unidad (solo si la etiqueta lo marca
// como variante). Devuelve null si no es ese caso.
function repeatedNamePack(variant: string, name: string, allowPlain: boolean): string | null {
  const v = normalizeName(variant);
  const n = normalizeName(name);
  if (!n || !(v === n || v.startsWith(n + " "))) return null;
  const rest = v.slice(n.length).trim();
  const m = rest.match(/^x\s?(\d{1,2})$/);
  if (m) return Number(m[1]) === 1 ? "1 Unidad" : `${Number(m[1])} Unidades`;
  return !rest && allowPlain ? "1 Unidad" : null;
}

function splitVariant(nameWithVariant: string): { name: string; variant: string | null } {
  const m = nameWithVariant.match(VARIANT_KEY);
  if (!m || m.index === undefined) return { name: nameWithVariant.trim(), variant: null };
  const rest = nameWithVariant.slice(m.index + m[0].length).replace(new RegExp(VARIANT_KEY.source, "gi"), "/ ");
  const name = nameWithVariant.slice(0, m.index).trim();
  const variant = rest.trim() || null;
  return { name, variant: (variant && repeatedNamePack(variant, name, true)) || variant };
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
  // byCarrier: en qué transportadora iba cada una (sale de la guía de su
  // etiqueta; "" si no se supo la guía).
  variants: { label: string; quantity: number; byCarrier?: Record<string, number> }[];
  // Cuántas unidades se alcanzaron a encontrar en las etiquetas (con o sin
  // variante) — solo diagnóstico/aviso.
  labelUnits: number;
  // Lo mismo por transportadora (2026-10-01, corte MF-0019): sin esto el
  // relleno "Sin variante" de cada transportadora se contaba dos veces.
  labelUnitsByCarrier?: Record<string, number>;
};

// Confirmado 2026-09-23 con un manifiesto real del usuario: una guía de
// GARANTÍA viene en el mismo PDF con "Tipo de logistica: SIN RECAUDO" (las
// de Servientrega además empiezan con 745…). Sus productos se sacan de la
// etiqueta de ESA guía — Yair después indica si sale completo, solo parte
// del combo o solo una pieza.
export type ParsedWarrantyLine = { guide: string; carrier: string; code: string; name: string; quantity: number; variant: string | null };

export type ParsedGuidesPdf = {
  manifestDate: string | null;
  // codes: productos que trae la etiqueta de la guía (de ahí sale su marca).
  // sender: remitente/tienda impreso en la etiqueta (ej. "GUSTAVO URIBE" =
  // tienda Alonfe de Shanghai) — de ahí sale el Seguimiento de tiendas.
  guides: { number: string; carrier: string; warranty: boolean; codes: string[]; sender?: string | null }[];
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
// 2026-09-29 (manifiestos del 22–25/09): algunas relaciones de Dropi vienen
// con el número pegado a "Ciudad Destino" ("D002047127Ciudad Destino") — sin
// el corte, la guía quedaba como "D002047127CIUDAD" y no se hallaba su etiqueta.
// 2026-10-01 (corte MF-0019): desde la guía 10 Dropi puede pegar el número
// a "Guia" ("Nro: 10Guia: LC55622371") — con \s+ esa guía se perdía.
const GUIDE_RE = /Nro:\s*\d+\s*Guia:\s*([A-Z0-9-]+?)(?=\s|Ciudad|$)/i;
const CARRIER_RE = /TRANSPORTADORA:\s*([A-Z0-9 ]+?)\s*$/i;
const DATE_RE = /FECHA MANIFIESTO \(DD\/MM\/YYYY\):\s*(\d{2})-(\d{2})-(\d{4})/;
// Greedy a propósito: "(103511)CUATRO ALMOHADAS X4 X1" → la cantidad es el
// ÚLTIMO "X<n>", no el "X4" que es parte del nombre.
// El "(ID)" puede venir pegado a la dirección cuando es larga (Laar, real
// 2026-09-28: "…Jonathan Ocampo(113467)HIDROLAVADORA … X1"); en ese caso
// solo se acepta si el ID está en la tabla resumen (ver `glued` abajo).
const ID_LABEL_RE = /(?<![\d(])\((\d{3,})\)\s*(.+)\s+X\s?(\d+)\b/;
// Palabras de relleno al comparar nombres por palabras en común.
const NAME_STOPWORDS = new Set(["del", "los", "las", "una", "unos", "unas", "con", "para", "por", "tipo"]);
const GINTRA_PART_RE = /^(\d+)(?:[.,]\d+)?\s*\*\s*(.+)$/;
const URBANO_ROW_RE = /^\s*\d{1,2}\s{2,}(.+?)\s{2,}(\d+)\s*$/;

// Nombres del resumen de Dropi vienen cortados a ~40 caracteres: si el
// nombre ya viene cortado, lo que sigue en la etiqueta es el resto del
// nombre, no una variante.
const SUMMARY_NAME_CUT = 38;

function variantWithCarriers(label: string, byCarrier: Map<string, number>): { label: string; quantity: number; byCarrier: Record<string, number> } {
  return { label, quantity: [...byCarrier.values()].reduce((a, b) => a + b, 0), byCarrier: Object.fromEntries(byCarrier) };
}

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

function parseRocketPages(pages: PdfLine[][], warrantyFile = false): ParsedGuidesPdf {
  const guides = new Map<string, { carrier: string; warranty: boolean }>();
  const normal = new Map<string, { name: string; byCarrier: Map<string, number>; variants: Map<string, Map<string, number>>; labeled: number }>();
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

  const codesByGuide = new Map<string, Set<string>>();
  const add = (code: string, rawName: string, orders: number, guide: string, carrier: string, isWarranty: boolean) => {
    if (!codesByGuide.has(guide)) codesByGuide.set(guide, new Set());
    codesByGuide.get(guide)!.add(code);
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
      let v = row.variants.get(key);
      if (!v) row.variants.set(key, (v = new Map()));
      v.set(carrier, (v.get(carrier) ?? 0) + qty);
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
    // PDF marcado "Garantías" por Yair → todo es garantía segura.
    const isWarranty = warrantyFile || /SIN\s+RECAUDO/i.test(text);

    const gin = gintracomRocketLabel(lines);
    if (gin) {
      if (isWarranty && !warrantyFile) uncertain.add(gin.guide);
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
      // Hojas sueltas casi vacías (ej. solo "CORREOS", visto 2026-09-28) no
      // son etiquetas: no se avisa.
      if (text.replace(/\s/g, "").length > 20) pagesWithoutGuide.push(pageIdx + 1);
      continue;
    }
    const guide = g[1].toUpperCase();
    const carrier = carrierFromGuide(guide);
    guides.set(guide, { carrier, warranty: isWarranty });
    if (isWarranty && !warrantyFile) uncertain.add(guide);
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
    warnings.push(
      `En ${pagesWithoutGuide.length} página(s) no encontré el número de guía (página ${pagesWithoutGuide.slice(0, 5).join(", ")}). Por qué: esa página no trae el código de barras de la guía como las demás. Qué hacer: abre el PDF en esa página; si es una etiqueta, sus productos NO se sumaron — avisa al administrador.`
    );
  }
  if (guidesWithoutProducts.length > 0) {
    warnings.push(
      `En ${guidesWithoutProducts.length} guía(s) no pude leer los productos (ej. ${guidesWithoutProducts.slice(0, 3).join(", ")}). Por qué: la parte de PRODUCTOS de esa etiqueta viene con otro formato o cortada. Qué hacer: esos productos NO se sumaron — revisa esa etiqueta y avisa al administrador.`
    );
  }
  const noCarrier = [...guides.entries()].filter(([, v]) => v.carrier === "SIN TRANSPORTADORA").map(([n]) => n);
  if (noCarrier.length > 0) {
    warnings.push(
      `No reconocí la transportadora de ${noCarrier.length} guía(s) (ej. ${noCarrier.slice(0, 3).join(", ")}). Por qué: el número de guía no empieza como los de Gintracom, Laar, Servientrega, Veloces o Urbano. Qué hacer: puedes guardar; esas guías salen como "sin transportadora" en el corte.`
    );
  }

  const lines: ParsedGuidesLine[] = [...normal.entries()].map(([code, r]) => ({
    code,
    name: r.name,
    quantity: r.labeled,
    byCarrier: Object.fromEntries(r.byCarrier),
    variants: [...r.variants.entries()].map(([label, m]) => variantWithCarriers(label, m)).sort((a, b) => b.quantity - a.quantity),
    labelUnits: r.labeled,
    labelUnitsByCarrier: Object.fromEntries(r.byCarrier),
  }));
  return {
    manifestDate,
    guides: [...guides.entries()].map(([number, v]) => ({ number, carrier: v.carrier, warranty: v.warranty, codes: [...(codesByGuide.get(number) ?? [])] })),
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
// `warrantyFile`: Yair marcó este PDF como el de la sección Garantías de Dropi.
export async function parseGuidesPdf(bytes: Uint8Array, { warrantyFile = false }: { warrantyFile?: boolean } = {}): Promise<ParsedGuidesPdf & { source: "DROPI" | "ROCKET" }> {
  const pages = await extractPages(bytes);
  const hasDropiSummary = pages.some((lines) => lines.some((l) => SUMMARY_RE.test(l.text)));
  // RKT…: un PDF con solo etiquetas de Gintracom de Rocket no trae "ROC." ni
  // "ROCKET" en ningún lado (caso real 2026-09-26: etiquetas_1790429953).
  const looksRocket = pages.some((lines) => lines.some((l) => /ROCKET ECOMFULLFILMENT|\bROC\.[a-z]|\bRKT\d{6,}\b/i.test(l.text)));
  if (!hasDropiSummary && looksRocket) return { ...parseRocketPages(pages, warrantyFile), source: "ROCKET" };
  return { ...parseDropiPages(pages, warrantyFile), source: "DROPI" };
}

export async function parseDropiGuidesPdf(bytes: Uint8Array): Promise<ParsedGuidesPdf> {
  return parseDropiPages(await extractPages(bytes));
}

// Dropi a veces reimprime una guía dentro del mismo PDF (caso real
// 2026-09-29, Manifiesto_25-09-2026_Provedix: la garantía V4003117191 venía
// dos veces completa — relación, tabla y etiqueta — y salía 2 veces). Cada
// bloque = páginas "Guia:" + su tabla + sus etiquetas; si TODAS las guías de
// un bloque ya salieron antes en el PDF, el bloque entero se ignora.
function dropRepeatedDropiBlocks(pages: PdfLine[][]): { pages: PdfLine[][]; repeated: string[] } {
  const guidesOf = (lines: PdfLine[]) => lines.map((l) => l.text.match(GUIDE_RE)?.[1].toUpperCase()).filter((g): g is string => !!g);
  const blocks: PdfLine[][][] = [];
  let prevHadGuides = false;
  for (const lines of pages) {
    const has = guidesOf(lines).length > 0;
    if (blocks.length === 0 || (has && !prevHadGuides)) blocks.push([]);
    blocks[blocks.length - 1].push(lines);
    prevHadGuides = has;
  }
  const seen = new Set<string>();
  const kept: PdfLine[][] = [];
  const repeated: string[] = [];
  for (const block of blocks) {
    const gs = block.flatMap(guidesOf);
    if (gs.length > 0 && gs.every((g) => seen.has(g))) {
      repeated.push(...new Set(gs));
      continue;
    }
    for (const g of gs) seen.add(g);
    kept.push(...block);
  }
  return { pages: kept, repeated };
}

// Texto que nunca es un remitente (encabezados/valores vecinos en la etiqueta).
const NOT_SENDER_RE = /^(FACTURA|DESTINATARIO|REMITENTE|RECAUDO|CONTENIDO|PRODUCTOS|VALOR|PESO|TOTAL|\$|[\d\s\-|:./]+$)/i;

function senderOf(lines: PdfLine[], i: number): string | null {
  const text = lines[i].text.trim();
  const clean = (s: string | undefined) => {
    const v = (s ?? "").replace(/\s*Celular\s+Tienda:.*$/i, "").replace(/\s+/g, " ").trim();
    return v.length >= 3 && /[A-Za-zÁÉÍÓÚÑáéíóúñ]{2}/.test(v) && !NOT_SENDER_RE.test(v) ? v : null;
  };
  const r = text.match(/^REMITENTE:\s*(.+)$/i);
  if (r) return clean(r[1]);
  if (/^DROPI\s+S\.A\.S\.?$/i.test(text)) return clean(lines[i + 1]?.text);
  const t = text.match(/Nombre de la tienda:\s*(.*)$/i);
  if (t) return clean(t[1]) ?? clean(lines[i + 1]?.text);
  return null;
}

// Pedido del usuario 2026-10-01: la tienda de una etiqueta se reconoce si su
// nombre de etiqueta (Store.labelSender) está dentro del remitente leído —
// Laar lo trae pegado a la ciudad ("GUSTAVO URIBE GUAYAQUIL").
export function senderMatches(sender: string | null | undefined, labelSender: string): boolean {
  if (!sender) return false;
  const a = normalizeName(sender);
  const b = normalizeName(labelSender);
  return !!b && (` ${a} `).includes(` ${b} `);
}

function parseDropiPages(allPages: PdfLine[][], warrantyFile = false): ParsedGuidesPdf {
  const { pages, repeated } = dropRepeatedDropiBlocks(allPages);

  let manifestDate: string | null = null;
  let carrier = "";
  const guides = new Map<string, { carrier: string; warranty: boolean }>();
  // Las garantías nunca se cobran (confirmado por Yair): una guía CON
  // RECAUDO en un PDF marcado "Garantías" = lo marcó por error.
  const conRecaudo: string[] = [];
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
      if (g) {
        guides.set(g[1].toUpperCase(), { carrier, warranty: false });
        if (/CON\s+RECAUDO/i.test(l.text)) conRecaudo.push(g[1].toUpperCase());
      }
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
    // nombre corto — eso no es una variante, salvo que termine en "X<n>"
    // (paquete, ver repeatedNamePack).
    const pack = rest ? repeatedNamePack(rest, best.norm, false) : null;
    if (pack) return { code: best.code, variant: pack };
    const repeatsName = rest && best.norm.split(" ").slice(0, 2).every((w) => rest.includes(w));
    return { code: best.code, variant: rest && !best.cut && !truncated && !repeatsName ? rest : null };
  };

  const hits: LabelHit[] = [];
  // Productos escritos en una etiqueta que no se parecen a ningún nombre de
  // la tabla — se muestran tal cual en el aviso para que Yair vea el porqué.
  const unmatched: { text: string; page: number; line: number; qty?: number }[] = [];
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
  // Remitente de cada etiqueta (pedido del usuario 2026-10-01, Seguimiento de
  // tiendas). Formatos reales vistos en los PDF del 21–30/09: Servientrega
  // "DROPI S.A.S." y en la línea siguiente la tienda ("GUSTAVO URIBE"); Laar
  // "REMITENTE: GUSTAVO URIBE GUAYAQUIL"; otro formato "Nombre de la tienda:".
  const senderSpots: { text: string; page: number; line: number }[] = [];

  pages.forEach((lines, p) => {
    for (let i = 0; i < lines.length; i++) {
      const text = lines[i].text;
      if (GUIDE_RE.test(text)) continue;
      const compact = text.replace(/[\s*]/g, "").toUpperCase();
      for (const g of guideTokens) if (compact.includes(g)) guideSpots.push({ guide: g, page: p, line: i });
      if (/orden\s+de\s+garant/i.test(text)) garantiaSpots.push({ page: p, line: i });
      const sender = senderOf(lines, i);
      if (sender) senderSpots.push({ text: sender, page: p, line: i });
      if (SUMMARY_RE.test(text) || /\(ID:/.test(text)) continue;

      // Servientrega / Laar / Veloces: traen el ID de Dropi.
      let idm = text.match(ID_LABEL_RE);
      // Veloces parte un producto largo en dos renglones (real 2026-10-02,
      // guía V4003182384): "(193889)Funda … COLOR: Mujer" y abajo
      // "TALLA: M  X1". Se une con los renglones siguientes hasta hallar el
      // "X<n>", sin pasar a otro "(ID)" ni a "Observaciones".
      if (!idm && /(?<![\d(])\(\d{3,}\)\s*\S/.test(text)) {
        let joined = text;
        for (let j = i + 1; j < lines.length && j <= i + 2; j++) {
          const next = lines[j].text;
          if (/\(\d{3,}\)|^\s*(Observaciones|Direcci|Tel[eé]fono|Destinatario)/i.test(next) || GUIDE_RE.test(next)) break;
          joined += " " + next.trim();
          const jm = joined.match(ID_LABEL_RE);
          if (jm) {
            idm = jm;
            i = j;
            break;
          }
        }
      }
      const glued = idm && idm.index! > 0 && !/[\s-]/.test(text[idm.index! - 1]);
      if (idm && (!glued || summary.has(idm[1]))) {
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
          else unmatched.push({ text: pm[2].trim(), page: p, line: i, qty: Number(pm[1]) });
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
          else unmatched.push({ text: um[1].trim(), page: p, line: j, qty: Number(um[2]) });
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

  // Pedido del usuario 2026-09-30 (Manifiesto_24-09-2026_Shanghai, guía
  // D002056261): la tabla dice «Urinario femenino portátil» y la etiqueta de
  // Gintracom «Urinario Unisex portátil». Si el nombre de una etiqueta no
  // coincide, se busca por palabras en común (mismo criterio 60%/mínimo 2 que
  // findSimilarUnlinkedItem), pero SOLO entre los productos a los que todavía
  // les falta una unidad por leer en esa misma transportadora — así la tabla
  // confirma que esa etiqueta es de ese producto. Si hay empate, no se adivina.
  if (unmatched.length > 0) {
    const words = (s: string) => new Set(normalizeName(s).split(" ").filter((w) => w.length >= 3 && !NAME_STOPWORDS.has(w)));
    const readBy = new Map<string, number>(); // "code|transportadora" → leídos
    for (const h of hits) {
      const k = `${h.code}|${guides.get(guideOf(h) ?? "")?.carrier ?? ""}`;
      readBy.set(k, (readBy.get(k) ?? 0) + h.qty);
    }
    for (let u = unmatched.length - 1; u >= 0; u--) {
      const um = unmatched[u];
      const qtyMatch = um.qty ?? 1;
      const c = guides.get(guideOf({ code: "", variant: null, qty: 0, page: um.page, line: um.line }) ?? "")?.carrier ?? "";
      const labelWords = words(um.text);
      let best: { code: string; score: number } | null = null;
      let tie = false;
      for (const [code, row] of summary) {
        const left = (row.byCarrier.get(c) ?? 0) - (readBy.get(`${code}|${c}`) ?? 0);
        if (left < qtyMatch) continue;
        const w = words(row.name);
        const smaller = Math.min(labelWords.size, w.size);
        if (smaller < 2) continue;
        let inter = 0;
        for (const x of labelWords) if (w.has(x)) inter++;
        if (inter < Math.max(2, Math.ceil(smaller * 0.6))) continue;
        const score = inter / smaller;
        if (!best || score > best.score) {
          best = { code, score };
          tie = false;
        } else if (score === best.score) tie = true;
      }
      if (!best || tie) continue;
      hits.push({ code: best.code, variant: null, qty: qtyMatch, page: um.page, line: um.line });
      readBy.set(`${best.code}|${c}`, (readBy.get(`${best.code}|${c}`) ?? 0) + qtyMatch);
      unmatched.splice(u, 1);
    }
  }

  // Garantía en Dropi (confirmado con Yair 2026-09-25): Dropi descarga las
  // garantías en su PROPIA sección → un PDF aparte, con el mismo formato y
  // sin ninguna palabra "garantía" (ej. real documento-25-09-2026_1525.pdf).
  // Yair marca ese PDF como "Garantías" al subirlo (`warrantyFile`) y TODAS
  // sus guías son garantía. En el PDF normal nada es garantía: "SIN
  // RECAUDO" (ej. Servientrega 7…) = pago anticipado → pedido normal.
  // Única señal escrita que se mantiene: Veloces "orden de garantía".
  const garantiaGuides = new Set<string>();
  for (const spot of garantiaSpots) {
    const g = guideOf({ code: "", variant: null, qty: 0, page: spot.page, line: spot.line });
    if (g) garantiaGuides.add(g);
  }
  const uncertainWarrantyGuides: string[] = [];
  for (const [n, g] of guides) g.warranty = warrantyFile || garantiaGuides.has(n);
  const warrantyGuides = new Set([...guides.entries()].filter(([, g]) => g.warranty).map(([n]) => n));
  const warranty: ParsedWarrantyLine[] = [];
  const byLabel = new Map<string, Map<string, Map<string, number>>>(); // code → variante ("" = sin variante) → transportadora → unidades
  const ordersRead = new Map<string, number>(); // code → pedidos leídos en etiquetas
  const packExtra = new Map<string, Map<string, number>>(); // code → transportadora → unidades extra por paquetes
  const codesByGuide = new Map<string, Set<string>>();
  for (const h of hits) {
    const hg = guideOf(h);
    if (hg) {
      if (!codesByGuide.has(hg)) codesByGuide.set(hg, new Set());
      codesByGuide.get(hg)!.add(h.code);
    }
    const g = warrantyGuides.size > 0 ? hg : null;
    if (warrantyFile || (g && warrantyGuides.has(g))) {
      warranty.push({
        guide: g ?? "SIN GUÍA",
        carrier: (g && guides.get(g)?.carrier) || [...guides.values()][0]?.carrier || "SIN TRANSPORTADORA",
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
    const c = (hg && guides.get(hg)?.carrier) || "";
    const n = packSize(key);
    if (n) {
      key = packLabel(n);
      // Unidades de más sobre el pedido, en la transportadora de su guía.
      let e = packExtra.get(h.code);
      if (!e) packExtra.set(h.code, (e = new Map()));
      e.set(c, (e.get(c) ?? 0) + h.qty * (n - 1));
    }
    let byC = m.get(key);
    if (!byC) m.set(key, (byC = new Map()));
    byC.set(c, (byC.get(c) ?? 0) + h.qty * (n ?? 1));
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
    const labelUnitsByCarrier: Record<string, number> = {};
    for (const byC of labels?.values() ?? []) for (const [c, q] of byC) labelUnitsByCarrier[c] = (labelUnitsByCarrier[c] ?? 0) + q;
    const labelUnits = Object.values(labelUnitsByCarrier).reduce((a, b) => a + b, 0);
    const variants = labels ? [...labels.entries()].filter(([k]) => k).map(([label, byC]) => variantWithCarriers(label, byC)) : [];
    lines.push({ code, name: s.name, quantity, byCarrier, variants: variants.sort((a, b) => b.quantity - a.quantity), labelUnits, labelUnitsByCarrier });
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

  // Primer remitente legible de cada guía (la etiqueta más cercana en la página).
  const senderByGuide = new Map<string, string>();
  for (const s of senderSpots) {
    const g = guideOf({ code: "", variant: null, qty: 0, page: s.page, line: s.line });
    if (g && !senderByGuide.has(g)) senderByGuide.set(g, s.text);
  }

  const warnings: string[] = [];
  if (repeated.length > 0) {
    warnings.push(
      `${repeated.length === 1 ? "La guía" : `${repeated.length} guías`} ${repeated.slice(0, 5).join(", ")} ${repeated.length === 1 ? "venía" : "venían"} repetida(s) en el PDF. Por qué: Dropi la imprimió dos veces en el mismo manifiesto. Qué hacer: nada — se contó una sola vez.`
    );
  }
  if (warrantyFile && conRecaudo.length > 0) {
    warnings.push(
      `⚠ Marcaste este PDF como Garantías, pero ${conRecaudo.length} guía(s) se cobran al entregar (ej. ${conRecaudo.slice(0, 3).join(", ")}) — las garantías nunca se cobran. ¿Es el PDF de pedidos? Si es así, cámbialo a "Pedidos" y vuelve a leer.`
    );
  }
  for (const p of packUnread) {
    warnings.push(
      `⚠ ${p.name}: se vende en paquetes (1, 2, 4 unidades…) y no pude leer ${p.orders} etiqueta(s) — cada una se contó como 1 unidad, puede faltar. Revisa esas etiquetas al preparar.`
    );
  }
  // Pedido de Yair 2026-09-28: decir AHÍ MISMO por qué no se leyó y si
  // importa, no solo "no pude leer". Por cada producto: en qué
  // transportadora falta, qué guías de esa transportadora quedaron sin
  // ningún producto leído y qué texto de etiqueta no se reconoció.
  const carrierOfGuide = (g: string | null) => (g && guides.get(g)?.carrier) || "";
  const emptyGuides = [...guides.entries()].filter(([n, g]) => !g.warranty && !codesByGuide.has(n));
  const unmatchedAt = unmatched.map((u) => {
    const guide = guideOf({ code: "", variant: null, qty: 0, page: u.page, line: u.line });
    return { text: u.text, guide, carrier: carrierOfGuide(guide) };
  });
  const readAt = new Map<string, number>(); // "code|transportadora" → pedidos leídos
  for (const h of hits) {
    const k = `${h.code}|${carrierOfGuide(guideOf(h))}`;
    readAt.set(k, (readAt.get(k) ?? 0) + h.qty);
  }
  for (const l of lines.filter((x) => x.labelUnits < x.quantity)) {
    const missing = l.quantity - l.labelUnits;
    const shortCarriers = [...summary.get(l.code)!.byCarrier].filter(([c, q]) => q > (readAt.get(`${l.code}|${c}`) ?? 0)).map(([c]) => c);
    const reasons: string[] = [];
    for (const c of shortCarriers) {
      const where = c || "sin transportadora";
      const texts = unmatchedAt.filter((u) => u.carrier === c);
      if (texts.length > 0) {
        reasons.push(
          `en ${where} hay etiqueta(s) que dicen ${texts
            .slice(0, 2)
            .map((t) => `«${t.text}»${t.guide ? ` (guía ${t.guide})` : ""}`)
            .join(", ")} y ese nombre no se parece al de la tabla`
        );
      }
      const empty = emptyGuides.filter(([, g]) => g.carrier === c).map(([n]) => n);
      if (empty.length > 0) {
        reasons.push(
          `en ${where} no encontré ningún producto en la etiqueta de la guía ${empty.slice(0, 3).join(", ")}${empty.length > 3 ? ` y ${empty.length - 3} más` : ""} (la etiqueta viene con otro formato o el texto está pegado/cortado)`
        );
      }
      if (texts.length === 0 && empty.length === 0) reasons.push(`en ${where} no encontré su línea de producto en ninguna etiqueta`);
    }
    const impact =
      l.variants.length > 0
        ? `este producto sí tiene colores/tallas — al preparar, mira en la etiqueta cuál es ${missing === 1 ? "la unidad que falta" : `las ${missing} unidades que faltan`}.`
        : l.labelUnits > 0
          ? "no afecta. Las demás etiquetas de este producto no traen color/talla y el total ya está bien (sale de la tabla)."
          : "el total ya está bien (sale de la tabla). Solo si este producto tiene colores/tallas, mira la etiqueta al preparar.";
    warnings.push(`${l.name}: la tabla dice ${l.quantity} y en las etiquetas leí ${l.labelUnits}. Por qué: ${reasons.join("; ")}. Qué hacer: ${impact}`);
  }
  // Pedido del usuario 2026-09-28 (caso LC55573158 de Laar): cada guía sin
  // ningún producto leído se nombra con su número, para que Yair lo vea al
  // subir y avise al admin ANTES de guardar para ajustar la lectura (si el
  // admin no está, puede guardar igual) — sin producto no se sabe su marca.
  if (emptyGuides.length > 0) {
    const list = emptyGuides.map(([n, g]) => `${n}${g.carrier ? ` (${g.carrier.charAt(0)}${g.carrier.slice(1).toLowerCase()})` : ""}`);
    warnings.push(
      `No pude leer el producto de ${emptyGuides.length === 1 ? "la guía" : `${emptyGuides.length} guías`} ${list.slice(0, 10).join(", ")}${list.length > 10 ? ` y ${list.length - 10} más` : ""}. Por qué: la etiqueta viene con otro formato o el texto está pegado/cortado. Qué hacer: ANTES de guardar, avisa al administrador y pásale este PDF para que ajuste la lectura y no se repita. Solo si el administrador no está disponible, guarda igual: los totales están bien (salen de la tabla), pero ${emptyGuides.length === 1 ? "esa guía sale" : "esas guías salen"} en "Sin marca" en el corte.`
    );
  }
  const noCarrier = [...guides.entries()].filter(([, v]) => !v.carrier || v.carrier === "SIN TRANSPORTADORA").map(([n]) => n);
  if (noCarrier.length > 0) {
    warnings.push(
      `No reconocí la transportadora de ${noCarrier.length} guía(s) (ej. ${noCarrier.slice(0, 3).join(", ")}). Por qué: en el PDF no encontré la línea "TRANSPORTADORA:" antes de esas guías. Qué hacer: puedes guardar; esas guías salen como "sin transportadora" en el corte.`
    );
  }

  return {
    manifestDate,
    guides: [...guides.entries()].map(([number, g]) => ({
      number,
      carrier: g.carrier,
      warranty: g.warranty,
      codes: [...(codesByGuide.get(number) ?? [])],
      sender: senderByGuide.get(number) ?? null,
    })),
    lines,
    warranty,
    unreadWarrantyGuides: [...warrantyGuides].filter((g) => !readWarranty.has(g)),
    uncertainWarrantyGuides,
    warnings,
  };
}

// Suma `l` dentro de `target` (mismo producto en otro PDF de la subida),
// conservando la transportadora de cada variante y de lo leído.
export function addGuidesLine(target: ParsedGuidesLine, l: ParsedGuidesLine): void {
  const add = (to: Record<string, number>, from: Record<string, number>) => {
    for (const [c, q] of Object.entries(from)) to[c] = (to[c] ?? 0) + q;
  };
  target.quantity += l.quantity;
  target.labelUnits += l.labelUnits;
  add(target.byCarrier, l.byCarrier);
  if (target.labelUnitsByCarrier && l.labelUnitsByCarrier) add(target.labelUnitsByCarrier, l.labelUnitsByCarrier);
  else target.labelUnitsByCarrier = undefined;
  for (const v of l.variants) {
    const same = target.variants.find((x) => x.label === v.label);
    if (!same) {
      target.variants.push({ ...v, byCarrier: v.byCarrier ? { ...v.byCarrier } : undefined });
      continue;
    }
    same.quantity += v.quantity;
    if (same.byCarrier && v.byCarrier) add(same.byCarrier, v.byCarrier);
    else same.byCarrier = undefined;
  }
}
