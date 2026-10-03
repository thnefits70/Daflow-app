import { prisma } from "@/lib/prisma";
import { extractPages, normalizeName, isRocketCode, ROCKET_PREFIX, type PdfLine, type ParsedGuidesLine } from "@/lib/dropiGuidesPdf";
import { resolveGuideLines } from "@/lib/fulfillmentGuides";
import { significantWords } from "@/lib/justCatalog";
import { notifyOwner } from "@/lib/notifications";
import { getInventoryLeadId } from "@/lib/guards";
import {
  WARRANTY_CITY,
  WARRANTY_MAX_DAYS,
  WARRANTY_NORMAL_DAYS,
  formatWarrantyCode,
  reasonDiscountsStock,
  type ExtraReasonCode,
  type WarrantyReasonCode,
} from "@/lib/localWarrantyConstants";

// Garantías locales (Guayaquil, motorizado propio) — pedido del usuario
// 2026-10-02. La garantía SIEMPRE nace de algo que de verdad salió y quedó
// registrado en DAFLOW: una guía de Dropi/Rocket de un corte enviado, o una
// venta externa ya entregada (Marcos). De ahí se copian solos el cliente,
// la dirección, el celular (si la etiqueta lo trae) y los productos con su
// cantidad — el asesor no los escribe, para no equivocarse, y nunca puede
// mandar más de lo que decía el original.

// pickupMinQty: desde cuántas unidades conviene recoger el producto dañado
// (ver WARRANTY_PICKUP_FREIGHT_AVG); null = no se conoce el costo. Lo pone
// la ruta de búsqueda — el asesor ve solo la recomendación, no el costo.
export type WarrantySourceLine = { catalogItemId: string; name: string; code: string | null; photo: string | null; quantity: number; alreadyUsed: number; pickupMinQty?: number | null };

export type WarrantySource = {
  kind: "GUIDE" | "SALE";
  ref: string;
  saleId: string | null;
  clientId: string | null;
  carrier: string | null;
  shippedAt: string; // ISO
  daysSince: number;
  city: string | null;
  isGuayaquil: boolean;
  originalCharge: number | null;
  clientName: string | null;
  clientAddress: string | null;
  clientPhone: string | null;
  notes: string | null;
  labelText: string[];
  lines: WarrantySourceLine[];
  warnings: string[];
  // Códigos de la guía que no están vinculados a ningún producto de
  // INVESTOCK (2026-10-02, los usa el Reingreso por escaneo de guía).
  unresolved?: { code: string; name: string; quantity: number }[];
};

export type LookupResult = { ok: true; source: WarrantySource } | { ok: false; error: string };

const DAY_MS = 24 * 60 * 60 * 1000;
const EXTERNAL_SALES_URL = "/area/workspace?tab=ventas-externas";

function cleanRef(ref: string): string {
  return ref.trim().toUpperCase().replace(/\s+/g, "");
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}

function normalizePhone(raw: string | null | undefined): string | null {
  const d = (raw ?? "").replace(/\D/g, "");
  if (d.length < 7) return null;
  return d.length === 9 && d.startsWith("9") ? `0${d}` : d;
}

function isGuayaquilCity(city: string | null | undefined): boolean {
  return normalizeName(city ?? "").includes(normalizeName(WARRANTY_CITY));
}

// ---- Lectura de la etiqueta (PDF ya guardado del corte) --------------------

const lineText = (l: PdfLine) => l.text.replace(/\s+/g, " ").trim();
const flat = (s: string) => s.replace(/\s+/g, "");

type LabelClient = { name: string | null; address: string | null; phone: string | null; notes: string | null };

function findIdx(lines: PdfLine[], re: RegExp, from = 0): number {
  for (let i = from; i < lines.length; i++) if (re.test(lineText(lines[i]))) return i;
  return -1;
}

// Cada transportadora imprime la etiqueta distinto (muestras reales del
// 2026-10-02). Si algo no se alcanza a leer, queda en null y el asesor ve el
// texto completo de la etiqueta — nunca se inventa un dato.
function labelClient(lines: PdfLine[], carrier: string): LabelClient {
  const c = carrier.toUpperCase();
  const out: LabelClient = { name: null, address: null, phone: null, notes: null };

  if (c.includes("GINTRA")) {
    // Columna izquierda debajo de "DESTINATARIO:" hasta "RECAUDO:":
    // nombre, dirección (1+ renglones), ciudad, provincia. Sin celular.
    const i = findIdx(lines, /DESTINATARIO:/i);
    if (i < 0) return out;
    const contenidoX = lines[i].items.find((it) => /CONTENIDO/i.test(it.str))?.x ?? 120;
    const left: string[] = [];
    for (let j = i + 1; j < lines.length && !/RECAUDO:/i.test(lineText(lines[j])); j++) {
      const t = lines[j].items.filter((it) => it.x < contenidoX - 4).map((it) => it.str).join(" ").replace(/\s+/g, " ").trim();
      if (t) left.push(t);
    }
    if (left.length > 0) out.name = left[0];
    if (left.length > 3) out.address = left.slice(1, -2).join(" ");
    else if (left.length > 1) out.address = left.slice(1).join(" ");
    return out;
  }

  if (c.includes("VELOCES")) {
    const d = findIdx(lines, /^Destinatario:?$/i);
    if (d >= 0 && lines[d + 1]) out.name = lineText(lines[d + 1]);
    const a = findIdx(lines, /^Direcci[oó]n:?$/i, Math.max(d, 0));
    const t = findIdx(lines, /^Tel[eé]fono:?$/i, Math.max(a, 0));
    if (a >= 0) out.address = lines.slice(a + 1, t > a ? t : a + 3).map(lineText).join(" ") || null;
    if (t >= 0 && lines[t + 1]) out.phone = normalizePhone(lineText(lines[t + 1]));
    const o = findIdx(lines, /^Observaciones:?$/i);
    if (o >= 0) out.notes = lines.slice(o + 1, o + 4).map(lineText).join(" ") || null;
    return out;
  }

  if (c.includes("LAAR")) {
    const d = findIdx(lines, /^DESTINO:/i);
    if (d < 0) return out;
    out.name = lineText(lines[d]).replace(/^DESTINO:\s*/i, "") || null;
    const p = findIdx(lines, /^PRODUCTO:/i, d);
    out.address = lines.slice(d + 1, p > d ? p : d + 2).map(lineText).join(" ") || null;
    for (let j = d + 1; j < lines.length; j++) {
      const m = lineText(lines[j]).match(/TEL:\s*(\d{7,10})/i);
      if (m) {
        out.phone = normalizePhone(m[1]);
        break;
      }
    }
    return out;
  }

  if (c.includes("URBANO")) {
    const d = findIdx(lines, /^Destinatario:/i);
    if (d < 0) return out;
    out.name = lineText(lines[d]).replace(/^Destinatario:\s*/i, "") || null;
    const a = findIdx(lines, /^Direcci[oó]n:/i, d);
    if (a >= 0) out.address = lineText(lines[a]).replace(/^Direcci[oó]n:\s*/i, "") || null;
    return out;
  }

  if (c.includes("SERVI")) {
    // Nombre, celular ("967408192--") y dirección en la columna izquierda;
    // el rótulo vertical "Destinatario" va pegado al margen (x < 20).
    const p = lines.findIndex((l) => /^\d{9,10}-*$/.test(flat(lineText(l))));
    if (p < 0) return out;
    out.phone = normalizePhone(lineText(lines[p]));
    if (p > 0) out.name = lineText(lines[p - 1]);
    const addr: string[] = [];
    for (let j = p + 1; j < lines.length; j++) {
      if (/\*\d+\*/.test(lineText(lines[j]))) break;
      const items = lines[j].items.filter((it) => it.x >= 20 && it.x < 90);
      if (items.length === 0) {
        // Solo el rótulo vertical "Destinatario" (x < 20): se salta.
        if (lines[j].items.every((it) => it.x < 20)) continue;
        break;
      }
      addr.push(items.map((it) => it.str).join(" "));
    }
    out.address = addr.join(" ").replace(/\s+/g, " ").trim() || null;
    return out;
  }

  return out;
}

type LabelProduct = { code: string | null; name: string; qty: number };

// Productos de la etiqueta de ESA guía (cantidad incluida).
function labelProducts(lines: PdfLine[], carrier: string, rocket: boolean): LabelProduct[] {
  const out: LabelProduct[] = [];
  const all = lines.map(lineText).join("\n");
  // Servientrega / Laar / Veloces / Rocket: "(147827) Nombre X2".
  for (const m of all.matchAll(/\((\d{2,})\)\s*([^()\n]+?)\s+X\s?(\d+)\b/gi)) {
    out.push({ code: rocket ? `${ROCKET_PREFIX}${m[1]}` : m[1], name: m[2].trim(), qty: Number(m[3]) });
  }
  if (out.length > 0) return out;

  const c = carrier.toUpperCase();
  if (c.includes("GINTRA")) {
    // Columna CONTENIDO: "1.00 * Mini Bicicleta Portatil | 1.00 * Liga …|"
    const i = findIdx(lines, /CONTENIDO:/i);
    if (i >= 0) {
      const cx = lines[i].items.find((it) => /CONTENIDO/i.test(it.str))?.x ?? 120;
      const text: string[] = [];
      for (let j = i + 1; j < lines.length && !/RECAUDO:/i.test(lineText(lines[j])); j++) {
        text.push(lines[j].items.filter((it) => it.x >= cx - 4).map((it) => it.str).join(" "));
      }
      for (const part of text.join(" ").split("|")) {
        const m = part.trim().match(/^(\d+)(?:[.,]\d+)?\s*\*\s*(.+)$/);
        if (m) out.push({ code: null, name: m[2].trim(), qty: Number(m[1]) });
      }
    }
  } else if (c.includes("URBANO")) {
    // Tabla "# PRODUCTO CANT" → "1  Consola Inalambrica Retro Pro  1".
    const h = findIdx(lines, /PRODUCTO.*CANT/i);
    if (h >= 0) {
      for (let j = h + 1; j < lines.length; j++) {
        const items = lines[j].items;
        if (items.length < 3 || !/^\d+$/.test(items[0].str.trim())) break;
        const qty = Number(items[items.length - 1].str.trim());
        if (!Number.isFinite(qty) || qty <= 0) break;
        out.push({ code: null, name: items.slice(1, -1).map((it) => it.str).join(" ").trim(), qty });
      }
    }
  }
  return out;
}

async function findGuideInPdfs(fileUrls: string[], guide: string) {
  for (const url of fileUrls) {
    let pages: PdfLine[][];
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      pages = await extractPages(new Uint8Array(await res.arrayBuffer()));
    } catch {
      continue;
    }
    let summary: { city: string | null; charge: number | null; manifestDay: string | null } | null = null;
    let label: PdfLine[] | null = null;
    let manifestDay: string | null = null;
    for (const page of pages) {
      const isSummary = page.some((l) => /Nro:\s*\d+\s*Guia/i.test(lineText(l)));
      if (isSummary) {
        // "FECHA MANIFIESTO (DD/MM/YYYY): 24-09-2026" — la fecha real en que
        // salió (el corte puede ser de otro día, p. ej. los atrasados).
        const date = page.map(lineText).join(" ").match(/FECHA MANIFIESTO[^:]*:\s*(\d{2})-(\d{2})-(\d{4})/i);
        if (date) manifestDay = `${date[3]}-${date[2]}-${date[1]}`;
        for (const l of page) {
          const t = lineText(l);
          if (!flat(t).includes(guide)) continue;
          const city = t.match(/Ciudad Destino:\s*(.+?)\s+Valor de Recaudo/i)?.[1]?.trim() ?? null;
          const charge = t.match(/Valor de Recaudo:\s*([\d.,]+)/i)?.[1];
          summary = { city, charge: charge ? Number(charge.replace(",", ".")) : null, manifestDay };
        }
      } else if (!label && page.some((l) => flat(lineText(l)).includes(guide))) {
        label = page;
      }
    }
    if (summary || label) return { summary, label };
  }
  return { summary: null, label: null };
}

async function usedByPreviousWarranties(where: { warrantySourceGuide?: string; warrantySourceSaleId?: string }): Promise<Map<string, number>> {
  const items = await prisma.externalSaleItem.findMany({
    where: { warrantyRole: "DELIVER", catalogItemId: { not: null }, sale: { kind: "WARRANTY", deletedAt: null, ...where } },
    select: { catalogItemId: true, quantity: true },
  });
  const used = new Map<string, number>();
  for (const it of items) used.set(it.catalogItemId!, (used.get(it.catalogItemId!) ?? 0) + it.quantity);
  return used;
}

// Pedido del usuario 2026-10-02: los productos de cada guía se leen UNA vez
// del PDF (al guardar Daniel el corte, y una pasada para las guías viejas) y
// quedan en FulfillmentRequestGuide.labelProducts — así escanear una
// devolución no abre el PDF entero cada vez (~5 s). Abre cada PDF del lote
// una sola vez y llena todas sus guías que falten. Devuelve cuántas llenó.
export async function cacheGuideLabelsForBatch(batchId: string): Promise<number> {
  const batch = await prisma.fulfillmentRequestBatch.findUnique({
    where: { id: batchId },
    select: { fileUrls: true, source: true, guides: { where: { labelCachedAt: null }, select: { id: true, guideNumber: true, carrier: true, codes: true } } },
  });
  if (!batch || batch.guides.length === 0 || batch.fileUrls.length === 0) return 0;
  const found = new Map<string, { products: LabelProduct[]; manifestDay: string | null }>();
  let filesRead = 0;
  for (const url of batch.fileUrls) {
    let pages: PdfLine[][];
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      pages = await extractPages(new Uint8Array(await res.arrayBuffer()));
    } catch (e) {
      console.error("[cacheGuideLabelsForBatch] No se pudo leer el PDF", url, e);
      continue;
    }
    filesRead++;
    let manifestDay: string | null = null;
    for (const page of pages) {
      if (!page.some((l) => /Nro:\s*\d+\s*Guia/i.test(lineText(l)))) continue;
      const date = page.map(lineText).join(" ").match(/FECHA MANIFIESTO[^:]*:\s*(\d{2})-(\d{2})-(\d{4})/i);
      if (date) {
        manifestDay = `${date[3]}-${date[2]}-${date[1]}`;
        break;
      }
    }
    for (const page of pages) {
      if (page.some((l) => /Nro:\s*\d+\s*Guia/i.test(lineText(l)))) continue;
      const text = flat(page.map(lineText).join(" "));
      for (const g of batch.guides) {
        if (found.has(g.guideNumber) || !text.includes(g.guideNumber)) continue;
        const rocket = batch.source === "ROCKET" || g.codes.some(isRocketCode);
        found.set(g.guideNumber, { products: labelProducts(page, g.carrier, rocket), manifestDay });
      }
    }
  }
  // Si algún PDF no se pudo abrir, no se marca nada: se reintenta después
  // (nunca se guarda "vacío" por un error de lectura).
  if (filesRead < batch.fileUrls.length) return 0;
  const now = new Date();
  let filled = 0;
  for (const g of batch.guides) {
    const f = found.get(g.guideNumber);
    // Sin etiqueta en el PDF: se guarda vacío igual (con la fecha) para no
    // volver a abrir el PDF por esta guía; el escaneo avisa y usa los códigos.
    await prisma.fulfillmentRequestGuide.update({
      where: { id: g.id },
      data: { labelProducts: f?.products ?? [], manifestDay: f?.manifestDay ?? null, labelCachedAt: now },
    });
    filled++;
  }
  return filled;
}

// Exportada 2026-10-02: también la usa el Reingreso por escaneo de guía
// (reentryGuideScan.ts) para saber qué productos traía la guía devuelta.
// productsOnly: solo hacen falta productos y fecha (no cliente/dirección):
// si la guía ya tiene sus productos guardados, no se abre el PDF.
export async function lookupGuide(guide: string, opts: { productsOnly?: boolean } = {}): Promise<LookupResult> {
  const row = await prisma.fulfillmentRequestGuide.findFirst({
    where: { guideNumber: { equals: guide, mode: "insensitive" } },
    select: {
      id: true,
      guideNumber: true,
      carrier: true,
      codes: true,
      labelProducts: true,
      manifestDay: true,
      labelCachedAt: true,
      batch: { select: { fileUrls: true, requestedAt: true, source: true, lot: { select: { day: true, status: true } } } },
    },
  });
  if (!row) return { ok: false, error: `La guía ${guide} no está registrada en DAFLOW. Solo se puede hacer garantía de una guía que salió en un corte.` };
  const lot = row.batch.lot;
  if (!lot || lot.status === "DRAFT") return { ok: false, error: `La guía ${row.guideNumber} todavía no salió: su corte no se ha enviado a Inventario.` };

  const warnings: string[] = [];
  const cached = opts.productsOnly && row.labelCachedAt ? ((row.labelProducts ?? []) as LabelProduct[]) : null;
  const { summary, label } = cached ? { summary: { city: null, charge: null, manifestDay: row.manifestDay }, label: null } : await findGuideInPdfs(row.batch.fileUrls, row.guideNumber);
  // Fecha del manifiesto (o del corte si no se pudo leer), al mediodía de
  // Ecuador para no caer en el día anterior.
  const shippedAt = new Date(`${summary?.manifestDay ?? lot.day}T17:00:00.000Z`);
  if (cached ? cached.length === 0 : !label) warnings.push("No se encontró la etiqueta de esta guía en el PDF guardado.");

  const rocket = row.batch.source === "ROCKET" || row.codes.some(isRocketCode);
  const client = label ? labelClient(label, row.carrier) : { name: null, address: null, phone: null, notes: null };
  let products = cached ?? (label ? labelProducts(label, row.carrier, rocket) : []);
  // Ya que se abrió el PDF, se guarda para la próxima vez.
  if (!cached && !row.labelCachedAt && label) {
    await prisma.fulfillmentRequestGuide
      .update({ where: { id: row.id }, data: { labelProducts: products, manifestDay: summary?.manifestDay ?? null, labelCachedAt: new Date() } })
      .catch(() => null);
  }

  // Productos sin código en la etiqueta (Gintracom/Urbano): se asignan a los
  // códigos que ya se guardaron de esa guía, por nombre.
  const codeResolutions = await resolveGuideLines(row.codes.map((code) => asLine(code, "", 1)), { skipSuggestions: true });
  const nameOfCode = new Map(
    codeResolutions.map((r) => [
      r.code,
      r.resolution.kind === "product" ? r.resolution.catalogItem.name : r.resolution.kind === "combo" ? (r.resolution.label ?? r.resolution.components.map((c) => c.catalogItem.name).join(" ")) : "",
    ])
  );
  products = products.map((p) => {
    if (p.code) return p;
    if (row.codes.length === 1) return { ...p, code: row.codes[0] };
    const words = significantWords(p.name);
    let best: string | null = null;
    let bestScore = 0;
    for (const code of row.codes) {
      const w = significantWords(nameOfCode.get(code) ?? "");
      const score = [...words].filter((x) => w.has(x)).length;
      if (score > bestScore) {
        best = code;
        bestScore = score;
      }
    }
    return { ...p, code: best };
  });
  for (const code of row.codes) {
    if (!products.some((p) => p.code === code)) {
      products.push({ code, name: nameOfCode.get(code) ?? code, qty: 1 });
      warnings.push(`No se pudo leer la cantidad de "${nameOfCode.get(code) || code}" en la etiqueta: se toma 1.`);
    }
  }

  const resolved = await resolveGuideLines(products.filter((p) => p.code).map((p) => asLine(p.code!, p.name, p.qty)), { skipSuggestions: true });
  const byItem = new Map<string, WarrantySourceLine>();
  const add = (item: { id: string; name: string; photos: string[]; justCode: string | null }, qty: number) => {
    const prev = byItem.get(item.id);
    if (prev) prev.quantity += qty;
    else byItem.set(item.id, { catalogItemId: item.id, name: item.name, code: item.justCode, photo: item.photos[0] ?? null, quantity: qty, alreadyUsed: 0 });
  };
  const unresolved: { code: string; name: string; quantity: number }[] = [];
  for (const r of resolved) {
    if (r.resolution.kind === "product") add(r.resolution.catalogItem, r.quantity);
    else if (r.resolution.kind === "combo") for (const comp of r.resolution.components) add(comp.catalogItem, comp.quantity * r.quantity);
    else {
      warnings.push(`El código ${r.code} (${r.name}) no está vinculado a un producto de INVESTOCK.`);
      unresolved.push({ code: r.code, name: r.name, quantity: r.quantity });
    }
  }

  const used = await usedByPreviousWarranties({ warrantySourceGuide: row.guideNumber });
  for (const l of byItem.values()) l.alreadyUsed = used.get(l.catalogItemId) ?? 0;

  const city = summary?.city ?? null;
  return {
    ok: true,
    source: {
      kind: "GUIDE",
      ref: row.guideNumber,
      saleId: null,
      clientId: null,
      carrier: row.carrier,
      shippedAt: shippedAt.toISOString(),
      daysSince: daysBetween(shippedAt, new Date()),
      city,
      isGuayaquil: isGuayaquilCity(city),
      originalCharge: summary?.charge ?? null,
      clientName: client.name,
      clientAddress: client.address,
      clientPhone: client.phone,
      notes: client.notes,
      labelText: label ? label.map(lineText).filter(Boolean).slice(0, 45) : [],
      lines: [...byItem.values()],
      warnings,
      unresolved,
    },
  };
}

function asLine(code: string, name: string, quantity: number): ParsedGuidesLine {
  return { code, name, quantity, byCarrier: {}, variants: [], labelUnits: 0 };
}

async function lookupSale(code: string): Promise<LookupResult> {
  const sale = await prisma.externalSale.findFirst({
    where: { code: { equals: code, mode: "insensitive" }, kind: "SALE" },
    select: {
      id: true,
      code: true,
      deliveredAt: true,
      deletedAt: true,
      returnedAt: true,
      totalAmount: true,
      clientName: true,
      clientPhone: true,
      client: { select: { id: true, name: true, phone: true, address: true, city: true } },
      items: { where: { rejectedAt: null, catalogItemId: { not: null } }, select: { catalogItemId: true, quantity: true, catalogItem: { select: { name: true, justCode: true, photos: true } } } },
    },
  });
  if (!sale || sale.deletedAt) return { ok: false, error: `La venta ${code} no existe en DAFLOW.` };
  if (!sale.deliveredAt) return { ok: false, error: `La venta ${sale.code} todavía no se entregó al motorizado.` };
  if (sale.returnedAt) return { ok: false, error: `La venta ${sale.code} fue devuelta: no aplica garantía.` };

  const byItem = new Map<string, WarrantySourceLine>();
  for (const it of sale.items) {
    const prev = byItem.get(it.catalogItemId!);
    if (prev) prev.quantity += it.quantity;
    else byItem.set(it.catalogItemId!, { catalogItemId: it.catalogItemId!, name: it.catalogItem!.name, code: it.catalogItem!.justCode, photo: it.catalogItem!.photos[0] ?? null, quantity: it.quantity, alreadyUsed: 0 });
  }
  const used = await usedByPreviousWarranties({ warrantySourceSaleId: sale.id });
  for (const l of byItem.values()) l.alreadyUsed = used.get(l.catalogItemId) ?? 0;

  // Las ventas de Marcos se entregan con motorizado propio: si el cliente no
  // tiene ciudad registrada se asume Guayaquil.
  const city = sale.client?.city ?? null;
  return {
    ok: true,
    source: {
      kind: "SALE",
      ref: sale.code,
      saleId: sale.id,
      clientId: sale.client?.id ?? null,
      carrier: null,
      shippedAt: sale.deliveredAt.toISOString(),
      daysSince: daysBetween(sale.deliveredAt, new Date()),
      city: city ?? WARRANTY_CITY,
      isGuayaquil: city ? isGuayaquilCity(city) : true,
      originalCharge: sale.totalAmount,
      clientName: sale.client?.name ?? sale.clientName,
      clientAddress: sale.client?.address ?? null,
      clientPhone: normalizePhone(sale.client?.phone ?? sale.clientPhone),
      notes: null,
      labelText: [],
      lines: [...byItem.values()],
      warnings: [],
    },
  };
}

export async function lookupWarrantySource(rawRef: string): Promise<LookupResult> {
  const ref = cleanRef(rawRef);
  if (!ref) return { ok: false, error: "Escribe el número de guía o el código de la venta (VE-0000)." };
  if (/^VE-?\d+$/.test(ref)) return lookupSale(ref.includes("-") ? ref : `VE-${ref.slice(2)}`);
  return lookupGuide(ref);
}

// ---- Crear la garantía -----------------------------------------------------

export type CreateWarrantyInput = {
  ref: string;
  deliver: { catalogItemId: string; quantity: number; reason: WarrantyReasonCode; pickupDefective: boolean }[];
  extras: { catalogItemId: string; quantity: number; reason: ExtraReasonCode; pickup: boolean }[];
  clientPhone: string;
  clientName?: string | null;
  clientAddress?: string | null;
  chargeMode: "NONE" | "ORIGINAL" | "CUSTOM";
  chargeAmount?: number | null;
  freightCost: number;
  pickupPersonName: string;
  evidenceUrls: string[];
  acceptLate: boolean;
};

export async function nextLocalWarrantyNumber(): Promise<number> {
  const updated = await prisma.platformSettings.update({ where: { id: "singleton" }, data: { lastLocalWarrantyNumber: { increment: 1 } } });
  return updated.lastLocalWarrantyNumber;
}

// saleNumber es único en toda la tabla y lo usan las ventas (VE-000X): las
// garantías toman su propio rango para no saltarse números de venta.
const WARRANTY_SALE_NUMBER_OFFSET = 1_000_000;

export async function createLocalWarranty(input: CreateWarrantyInput, advisorId: string): Promise<{ ok: true; id: string; code: string } | { ok: false; error: string }> {
  const looked = await lookupWarrantySource(input.ref);
  if (!looked.ok) return looked;
  const src = looked.source;

  if (!src.isGuayaquil) return { ok: false, error: `Esta guía es para ${src.city ?? "otra ciudad"}: la garantía con motorizado propio es solo para Guayaquil.` };
  if (src.daysSince > WARRANTY_MAX_DAYS) return { ok: false, error: `Ya pasaron ${src.daysSince} días desde que salió: el plazo máximo para una garantía es de ${WARRANTY_MAX_DAYS} días.` };
  const late = src.daysSince > WARRANTY_NORMAL_DAYS;
  if (late && !input.acceptLate) return { ok: false, error: `Pasaron ${src.daysSince} días (más de ${WARRANTY_NORMAL_DAYS}): confirma que igual se acepta.` };

  if (input.deliver.length === 0) return { ok: false, error: "Elige al menos un producto a entregar." };
  const byId = new Map(src.lines.map((l) => [l.catalogItemId, l]));
  const requested = new Map<string, number>();
  for (const d of input.deliver) {
    const line = byId.get(d.catalogItemId);
    if (!line) return { ok: false, error: "Uno de los productos no estaba en la guía original." };
    if (!Number.isInteger(d.quantity) || d.quantity < 1) return { ok: false, error: `Cantidad inválida para ${line.name}.` };
    requested.set(d.catalogItemId, (requested.get(d.catalogItemId) ?? 0) + d.quantity);
  }
  for (const [id, qty] of requested) {
    const line = byId.get(id)!;
    const left = line.quantity - line.alreadyUsed;
    if (qty > left) return { ok: false, error: `${line.name}: la guía original llevaba ${line.quantity}${line.alreadyUsed ? ` y ya se usaron ${line.alreadyUsed} en otra garantía` : ""} — puedes entregar máximo ${left}.` };
  }
  for (const e of input.extras) {
    if (!Number.isInteger(e.quantity) || e.quantity < 1) return { ok: false, error: "Cantidad inválida en lo que el cliente recibió por error." };
  }

  const needsEvidence = input.deliver.some((d) => d.reason !== "ORDEN_INCOMPLETA") || input.extras.length > 0;
  if (needsEvidence && input.evidenceUrls.length === 0) return { ok: false, error: "Adjunta las fotos o videos que revisaste para aceptar la garantía." };

  const phone = normalizePhone(input.clientPhone) ?? normalizePhone(src.clientPhone);
  if (!phone) return { ok: false, error: "Falta el celular del cliente: el motorizado lo necesita para coordinar la entrega y pedirle la ubicación." };
  const clientName = src.clientName ?? input.clientName?.trim() ?? null;
  const clientAddress = src.clientAddress ?? input.clientAddress?.trim() ?? null;
  if (!clientName) return { ok: false, error: "Falta el nombre del cliente." };
  if (!clientAddress) return { ok: false, error: "Falta la dirección de entrega." };

  if (!(input.freightCost > 0)) return { ok: false, error: "Pon cuánto cobra el motorizado por esta garantía." };
  if (!input.pickupPersonName.trim()) return { ok: false, error: "Elige el motorizado que lleva la garantía." };

  let charge = 0;
  if (input.chargeMode === "ORIGINAL") {
    if (src.originalCharge == null) return { ok: false, error: "No se pudo leer el valor de la guía original: escribe el valor acordado." };
    charge = src.originalCharge;
  } else if (input.chargeMode === "CUSTOM") {
    if (!(input.chargeAmount && input.chargeAmount > 0)) return { ok: false, error: "Escribe el valor acordado a cobrar." };
    charge = Math.round(input.chargeAmount * 100) / 100;
  }

  const extraIds = input.extras.map((e) => e.catalogItemId);
  const catalog = await prisma.purchaseCatalogItem.findMany({ where: { id: { in: [...requested.keys(), ...extraIds] } }, select: { id: true, name: true } });
  const nameOf = new Map(catalog.map((c) => [c.id, c.name]));
  if (extraIds.some((id) => !nameOf.has(id))) return { ok: false, error: "Uno de los productos recibidos por error no está en el catálogo." };

  const items = [
    ...input.deliver.map((d) => ({
      catalogItemId: d.catalogItemId,
      declaredProductName: nameOf.get(d.catalogItemId)!,
      quantity: d.quantity,
      unitPrice: 0,
      totalAmount: 0,
      warrantyRole: "DELIVER" as const,
      warrantyReason: d.reason,
      discountsStock: reasonDiscountsStock(d.reason),
    })),
    // La unidad dañada que el motorizado trae: ya se descontó en el corte
    // original, traerla no cambia el stock (solo queda el registro).
    ...input.deliver
      .filter((d) => d.pickupDefective && (d.reason === "MAL_FUNCIONAMIENTO" || d.reason === "PRODUCTO_ROTO"))
      .map((d) => ({
        catalogItemId: d.catalogItemId,
        declaredProductName: nameOf.get(d.catalogItemId)!,
        quantity: d.quantity,
        unitPrice: 0,
        totalAmount: 0,
        warrantyRole: "PICKUP" as const,
        warrantyReason: d.reason,
        discountsStock: false,
      })),
    // Lo que el cliente recibió por error: si vuelve, el stock no cambia
    // (nunca se descontó); si se lo queda, sale del stock al entregar.
    ...input.extras.map((e) => ({
      catalogItemId: e.catalogItemId,
      declaredProductName: nameOf.get(e.catalogItemId)!,
      quantity: e.quantity,
      unitPrice: 0,
      totalAmount: 0,
      warrantyRole: e.pickup ? ("PICKUP" as const) : ("UNRECOVERED" as const),
      warrantyReason: e.reason,
      discountsStock: !e.pickup,
    })),
  ];

  const n = await nextLocalWarrantyNumber();
  const code = formatWarrantyCode(n);
  const now = new Date();
  const sale = await prisma.externalSale.create({
    data: {
      kind: "WARRANTY",
      warrantyNumber: n,
      code,
      saleNumber: WARRANTY_SALE_NUMBER_OFFSET + n,
      advisorId,
      totalAmount: charge,
      items: { create: items },
      clientId: src.clientId,
      clientName,
      clientPhone: phone,
      deliveryAddress: clientAddress,
      deliveryCity: src.city,
      deliveryNotes: src.notes,
      pickupPersonName: input.pickupPersonName.trim(),
      freightCost: input.freightCost,
      isContraEntrega: false,
      facturaSolicitada: "NO",
      // Nace aprobada: el asesor ya revisó fotos/videos y la pide él mismo.
      reviewStatus: "APPROVED",
      reviewedAt: now,
      // Sin cobro no hay pago que confirmar.
      paymentConfirmedAt: charge > 0 ? null : now,
      warrantySourceGuide: src.kind === "GUIDE" ? src.ref : null,
      warrantySourceSaleId: src.saleId,
      warrantySourceCarrier: src.carrier,
      warrantyOriginalShippedAt: new Date(src.shippedAt),
      warrantyOriginalCharge: src.originalCharge,
      warrantyLate: late,
      warrantyEvidenceUrls: input.evidenceUrls,
    },
    select: { id: true, code: true },
  });

  const danielId = await getInventoryLeadId();
  if (danielId) {
    await notifyOwner(danielId, {
      title: "🛡️ Garantía local por despachar",
      body: `${sale.code} — garantía de ${src.ref} para ${clientName}. Asigna quién agrupa, igual que una venta externa.`,
      url: `${EXTERNAL_SALES_URL}&etab=agrupar`,
    }).catch(() => null);
  }
  return { ok: true, id: sale.id, code: sale.code };
}

// Lo que el motorizado tiene que traer y bodega todavía no confirmó.
export function pendingPickups(items: { warrantyRole: string | null; pickupReceivedAt: Date | null }[]): number {
  return items.filter((i) => i.warrantyRole === "PICKUP" && !i.pickupReceivedAt).length;
}
