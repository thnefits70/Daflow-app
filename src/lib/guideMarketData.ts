import { fixBrokenAccents, normalizeName, type PdfLine } from "@/lib/dropiGuidesPdf";

// Datos de mercado de cada guía (pedido del usuario 2026-10-10, etapa 1 de
// la página pública provedix.com): ciudad, provincia, valor cobrado al
// cliente, si el comprador es hombre o mujer, y la tienda (dropshipper) que
// vendió con su celular. Se leen del mismo PDF del corte, sin IA.
//
// Del CLIENTE FINAL solo se guarda ciudad/provincia/valor/sexo: su nombre se
// usa aquí para deducir el sexo y se descarta — nunca se guarda su nombre,
// celular ni dirección (decisión del usuario, Ley de Protección de Datos).
// La tienda y su celular nunca salen en provedix.com: son para Nairoby
// (encuestas de servicio/postventa a los dropshippers).
//
// Formatos reales (etiquetas del usuario 2026-10-10 + manifiestos 21–25/09):
//   - Relación de Dropi: "Nro: 1 Guia: D002060398  Ciudad Destino: MACHALA
//     Valor de Recaudo: 20.00" (Urbano a veces en 2–3 renglones).
//   - Gintracom: REMITENTE / tienda / dirección / ciudad / celular; el
//     destinatario termina en "Ambato AM3" + "Tungurahua".
//   - Veloces: "Nombre de la tienda: | Celular Tienda:" y debajo los valores;
//     "ESTADO: | CIUDAD:" y debajo "PICHINCHA | QUITO".
//   - Laar: "REMITENTE: Jose Mendez  GUAYAQUIL" y "TEL: 979039286" arriba a la
//     derecha (el primero es el de la tienda; el TEL de abajo es del cliente).
//   - Urbano: "Remite: B&C importadora 4226 - DROPI S.A.S", sin celular;
//     "Localidad: PELILEO - SAN PEDRO DE PELILEO - TUNGURAHUA" del destinatario.
//   - Servientrega: "DROPI S.A.S." y debajo la tienda, sin celular; ciudad
//     grande "PORTOVIEJO -" ("CL PORTOVIEJO" es el centro de Servientrega).

export type GuideMarketData = {
  city: string | null;
  province: string | null;
  codAmount: number | null;
  buyerGender: "F" | "M" | null;
  store: string | null;
  storePhone: string | null;
};

const lineText = (l: PdfLine) => fixBrokenAccents(l.text).replace(/\s+/g, " ").trim();

function findIdx(lines: PdfLine[], re: RegExp, from = 0): number {
  for (let i = from; i < lines.length; i++) if (re.test(lineText(lines[i]))) return i;
  return -1;
}

const itemsText = (items: PdfLine["items"]) => fixBrokenAccents(items.map((it) => it.str).join(" ")).replace(/\s+/g, " ").trim();

// "33,98" / "$32.98" → 32.98. Nada raro: menos de $1 o más de $2000 no es un
// pedido real (se descarta, nunca se adivina).
export function parseMoney(raw: string | null | undefined): number | null {
  const m = (raw ?? "").match(/(\d{1,4})[.,](\d{2})(?!\d)/) ?? (raw ?? "").match(/^\s*\$?\s*(\d{1,4})\s*$/);
  if (!m) return null;
  const v = Number(`${m[1]}.${m[2] ?? "00"}`);
  return v >= 1 && v <= 2000 ? v : null;
}

// Celular de Ecuador: 9 dígitos que empiezan en 9 → se guarda con el 0.
// Hay tiendas de Colombia (celular de 10 dígitos que empieza en 3) → +57;
// cualquier otro número se guarda tal cual, para que Nairoby igual lo vea.
export function normalizeStorePhone(raw: string | null | undefined): string | null {
  let d = (raw ?? "").replace(/\D/g, "");
  if (d.startsWith("593") && d.length === 12) d = d.slice(3);
  if (d.length === 9 && d.startsWith("9")) d = `0${d}`;
  if (/^09\d{8}$/.test(d) || /^0[2-7]\d{7,8}$/.test(d)) return d;
  if (/^3\d{9}$/.test(d)) return `+57${d}`;
  return d.length >= 7 && d.length <= 15 ? d : null;
}

// "Ambato AM3" / "Santo Domingo STD02" → sin el código interno de zona.
function cleanPlace(raw: string | null | undefined): string | null {
  const v = (raw ?? "")
    .replace(/\s+[A-Z]{2,4}\d{1,2}\b.*$/, "")
    .replace(/\s*-\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return v.length >= 3 && /[A-Za-zÁÉÍÓÚÑáéíóúñ]{3}/.test(v) ? v.toUpperCase() : null;
}

function cleanStore(raw: string | null | undefined): string | null {
  const v = (raw ?? "").replace(/\s+/g, " ").trim();
  return v && /[A-Za-zÁÉÍÓÚÑáéíóúñ0-9]/.test(v) ? v : null;
}

// ---- Relación de guías (primeras páginas de cada transportadora) ----------

const SUMMARY_GUIDE_RE = /Nro:\s*\d+\s*Guia:\s*([A-Z0-9-]+?)(?=\s|Ciudad|$)/i;
const SUMMARY_HEADER_RE = /^\s*Nro:\s*Guia:/i;
const SUMMARY_ROW_RE = /^\s*\d+\s+([A-Z]{0,4}\d{6,}[A-Z0-9]*)\b/i;
const CITY_RE = /Ciudad Destino:\s*(.*?)\s*(?=Valor de Recaudo|$)/i;
const COD_RE = /Valor de Recaudo:\s*(\d{1,4}[.,]\d{2})/i;

// guía → ciudad y valor, tal como Dropi los imprime en su relación (la fuente
// más pareja: igual para todas las transportadoras).
export function summaryMarketData(pages: PdfLine[][]): Map<string, { city: string | null; codAmount: number | null }> {
  const out = new Map<string, { city: string | null; codAmount: number | null }>();
  for (const lines of pages) {
    for (let i = 0; i < lines.length; i++) {
      const text = lineText(lines[i]);
      const one = text.match(SUMMARY_GUIDE_RE);
      if (one) {
        out.set(one[1].toUpperCase(), { city: cleanPlace(text.match(CITY_RE)?.[1]), codAmount: parseMoney(text.match(COD_RE)?.[1]) });
        continue;
      }
      // Urbano en renglones: encabezado "Nro: Guia: [Ciudad Destino: X]
      // Valor de Recaudo:", a veces la ciudad sola en el renglón siguiente y
      // la fila "4  WYB184213877  [COLORADOS]  49.99  RECAUDO".
      const row = text.match(SUMMARY_ROW_RE);
      if (!row) continue;
      let header = -1;
      for (let j = i - 1; j >= Math.max(0, i - 2); j--) {
        if (SUMMARY_HEADER_RE.test(lineText(lines[j]))) {
          header = j;
          break;
        }
      }
      if (header < 0) continue;
      let city = "";
      for (let j = header; j < i; j++) {
        const c = lineText(lines[j]).match(CITY_RE)?.[1];
        if (c) city = c;
      }
      const money = lines[i].items.find((it) => /^\d{1,4}[.,]\d{2}$/.test(it.str.trim()));
      // Lo que sigue de la ciudad cortada: texto entre la guía y el valor.
      const guideItem = lines[i].items.findIndex((it) => it.str.trim().toUpperCase() === row[1].toUpperCase());
      const rest = lines[i].items.slice(guideItem + 1).filter((it) => it !== money && /^[A-ZÁÉÍÓÚÑ .]+$/i.test(it.str.trim()) && !/^RECAUDO$/i.test(it.str.trim()));
      if (city && rest.length) city = `${city} ${rest.map((it) => it.str.trim()).join(" ")}`;
      out.set(row[1].toUpperCase(), { city: cleanPlace(city), codAmount: parseMoney(money?.str) });
    }
  }
  return out;
}

// ---- Etiqueta de la guía ---------------------------------------------------

type LabelData = Omit<GuideMarketData, "buyerGender">;

export function labelMarketData(lines: PdfLine[], carrier: string): LabelData {
  const c = carrier.toUpperCase();
  const out: LabelData = { city: null, province: null, codAmount: null, store: null, storePhone: null };
  const all = lines.map(lineText);

  // Valor cobrado (por si la relación no lo trae, p. ej. Rocket).
  const cod =
    all.join("\n").match(/(?:COD \(USD\)|RECAUDO|Total a Recaudar|VALOR A COBRAR):?\s*\$?\s*(\d{1,4}[.,]\d{2})/i)?.[1] ??
    all.join("\n").match(/\$\s*(\d{1,4}[.,]\d{2})/)?.[1];
  out.codAmount = parseMoney(cod);

  if (c.includes("GINTRA")) {
    const r = findIdx(lines, /^REMITENTE:?$/i);
    if (r >= 0) {
      const block: string[] = [];
      for (let j = r + 1; j < lines.length && !/SERVICIO|DESTINATARIO/i.test(all[j]); j++) block.push(all[j]);
      out.store = cleanStore(block[0]);
      out.storePhone = normalizeStorePhone([...block].reverse().find((t) => /^\d{9,12}$/.test(t.replace(/\s/g, ""))));
    }
    // Destinatario: … dirección …, "Ambato AM3", "Tungurahua" (columna izquierda).
    const d = findIdx(lines, /DESTINATARIO:/i);
    if (d >= 0) {
      const cx = lines[d].items.find((it) => /CONTENIDO/i.test(it.str))?.x ?? 120;
      const left: string[] = [];
      for (let j = d + 1; j < lines.length && !/RECAUDO:/i.test(all[j]); j++) {
        const t = itemsText(lines[j].items.filter((it) => it.x < cx - 4));
        if (t) left.push(t);
      }
      if (left.length >= 3) {
        out.city = cleanPlace(left[left.length - 2]);
        out.province = cleanPlace(left[left.length - 1]);
      }
    }
    return out;
  }

  if (c.includes("VELOCES")) {
    const t = findIdx(lines, /Nombre de la tienda:/i);
    if (t >= 0 && lines[t + 1]) {
      const px = lines[t].items.find((it) => /Celular/i.test(it.str))?.x ?? 170;
      out.store = cleanStore(itemsText(lines[t + 1].items.filter((it) => it.x < px - 10)));
      out.storePhone = normalizeStorePhone(itemsText(lines[t + 1].items.filter((it) => it.x >= px - 10)));
    }
    const e = findIdx(lines, /ESTADO:.*CIUDAD:/i);
    if (e >= 0 && lines[e + 1]) {
      const cx = lines[e].items.find((it) => /CIUDAD/i.test(it.str))?.x ?? 180;
      out.province = cleanPlace(itemsText(lines[e + 1].items.filter((it) => it.x < cx - 20)));
      out.city = cleanPlace(itemsText(lines[e + 1].items.filter((it) => it.x >= cx - 20)));
    }
    return out;
  }

  if (c.includes("LAAR")) {
    const r = findIdx(lines, /^REMITENTE:/i);
    if (r >= 0) {
      // "REMITENTE:  Jose Mendez  GUAYAQUIL": la ciudad de origen va a la derecha.
      const items = lines[r].items.filter((it) => !/^REMITENTE:?$/i.test(it.str.trim()));
      const named = items.length > 1 ? items.filter((it) => it.x < 200) : items;
      out.store = cleanStore(itemsText(named).replace(/^REMITENTE:\s*/i, ""));
      const dest = findIdx(lines, /^DESTINO:/i, r);
      for (let j = r; j < (dest > r ? dest : lines.length); j++) {
        const m = all[j].match(/TEL:\s*(\d{9,10})/i);
        if (m) {
          out.storePhone = normalizeStorePhone(m[1]);
          break;
        }
      }
    }
    return out;
  }

  if (c.includes("URBANO")) {
    const r = findIdx(lines, /^Remite:/i);
    if (r >= 0) out.store = cleanStore(all[r].replace(/^Remite:\s*/i, "").replace(/\s*\d+\s*-\s*DROPI\s+S\.?A\.?S\.?.*$/i, ""));
    const d = findIdx(lines, /^Destinatario:/i);
    const l = d >= 0 ? findIdx(lines, /^Localidad:/i, d) : -1;
    if (l >= 0) {
      const parts = all[l].replace(/^Localidad:\s*/i, "").split(/\s+-\s+/).map((s) => s.trim()).filter(Boolean);
      if (parts.length >= 3) {
        out.city = cleanPlace(parts[1]);
        out.province = cleanPlace(parts[parts.length - 1]);
      } else if (parts.length > 0) out.city = cleanPlace(parts[0]);
    }
    return out;
  }

  if (c.includes("SERVI")) {
    const s = all.findIndex((t) => /^(DROPI|ROCKET ECOMFULLFILMENT)\s+S\.A\.S\.?$/i.test(t));
    if (s >= 0 && lines[s + 1]) out.store = cleanStore(itemsText(lines[s + 1].items.filter((it) => it.x >= 20)));
    const city = all.find((t) => /^[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ .]{2,}\s*-\s*$/.test(t));
    out.city = cleanPlace(city);
    return out;
  }

  return out;
}

// ---- Hombre / mujer por el primer nombre -----------------------------------
// Aproximado (el usuario lo sabe): reglas del español + listas de nombres
// comunes en Ecuador que no siguen la regla. Si no se sabe, queda null.

const FEMALE = new Set(
  `carmen isabel raquel ruth beatriz mercedes dolores rocio consuelo amparo rosario pilar ines esther lourdes abigail maribel marisol soledad luz ingrid
  evelyn evelin jennifer jenifer yenifer karen lizbeth lisbeth belen jazmin yasmin noemi nicole nicol michelle mishell michel joselyn jocelyn yoselin
  madeleine allison alison nathaly nataly nathali natali stefany stephany estefany jessy yesenia gisel giselle jhoselyn yuliet juliet janeth yaneth lisseth
  liseth katherine katherin catherine kathy cathy sharon geraldine scarlet scarleth ivonne yvonne ximena dayanne dayana anahi nohemi raquel arely
  jeniffer marilyn merly mery mary sandy sindy cindy wendy betty fanny nancy norma gladys mariuxi maryuri yuri yuly leidy lady jady deisy daisy
  ester edith judith miriam myriam rubi ruby iris dulce cristel cristhel kristel shirley gissel jamileth jamilet nahomi naomi zoila maritza
  belkis yadira yaritza lucy lucia elizabeth elisabeth astrid karol carol carolay emily emely emilie anabel annabel mabel mishel genesis jessenia
  yessenia doris maite noelia rosmery rossmery roxana ivon liz lissette lisette yamileth marlene irene daysi deysi mercy vicky maybeline
  berenice monserrate jeannet jeannette janet janneth jaqueline jacqueline nayeli mely nely kely kelly anlly yuleidy juleidy leydi
  marisela grace gracie hellen helen jade lizeth lisbet maricel marbel sol ines yazmin jasmin yamilet mileth jenny nelly betsy marjorie guadalupe
  brigitte magaly yudy yudi katty angie aide aydee gretty zandy febe cleofe`.split(/\s+/).filter(Boolean)
);
const MALE = new Set(
  `jose luis juan carlos jorge miguel daniel david andres angel manuel kevin bryan brayan steven stiven jimmy henry freddy fredy danny andy jeffry jefferson
  jhon john jhonny johnny joel jonathan jhonatan cristhian christian cristian bolivar holger wilson nelson edison edinson elvis alexis erick eric ronny
  roberto mario pablo pedro raul ramon ruben victor oscar hector hugo diego fabian fernando gustavo julio cesar marcos mateo santiago sebastian nicolas
  tomas israel isaac abraham jose william willian wellington washington byron franklin klever kleber edgar edgardo omar walter xavier javier ivan
  segundo alberto adrian anthony antony elian dylan dilan jordy jordan josue jairo jaime joaquin leonardo luciano patricio rodrigo renato richard
  ricardo rafael ramiro geovanny giovanny jhonson stalin lenin vinicio galo efrain efren eduardo gabriel samuel ezequiel misael ismael
  noe moises elias jesus darwin denis dennis frank franco gary harry jeremy jeremias lucas luca josh joshua santi eddy
  maykel michael maicol mike rony rommel romel roger robert ronald alex aaron alan allan vicente felipe giovanni enrique dante
  guillermo jaime alexi jhony bladimir vladimir jefry rene nixon ivan junior henrry henry billy joffre
  franky willie jerry jhovanni richy amable`.split(/\s+/).filter(Boolean)
);
const SKIP = new Set(["sr", "sra", "srta", "senor", "senora", "don", "dona", "lic", "ing", "dr", "dra", "ma", "the"]);

export function genderFromName(raw: string | null | undefined): "F" | "M" | null {
  const words = normalizeName(raw ?? "").split(" ").filter((w) => w.length >= 2 && !SKIP.has(w) && !/\d/.test(w));
  // "María José" es mujer, "José María" es hombre: manda el primero.
  const [first, second] = words;
  if (!first) return null;
  if (first === "maria" || FEMALE.has(first)) return "F";
  if (MALE.has(first)) return "M";
  if (first.length >= 3) {
    if (/a$/.test(first)) return "F";
    if (/o$/.test(first)) return "M";
    // Terminados en consonante casi siempre son de hombre (las excepciones
    // de mujer están en la lista); -e/-i/-y no dicen nada.
    if (/[bcdfghjklmnpqrstvwxz]$/.test(first)) return "M";
  }
  // El segundo nombre solo si está en las listas: con reglas podría ser el
  // apellido ("Marlene García" no es mujer por "García").
  if (second === "maria" || (second && FEMALE.has(second))) return "F";
  if (second && MALE.has(second)) return "M";
  return null;
}
