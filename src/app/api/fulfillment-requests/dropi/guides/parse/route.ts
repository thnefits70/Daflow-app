import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { canSubmitFulfillmentRequest } from "@/lib/guards";
import { addGuidesLine, extractPages, parseGuidesPages, rocketNameCode, ROCKET_NAME_PREFIX, type ParsedGuidesLine, type ParsedWarrantyLine, type PdfLine } from "@/lib/dropiGuidesPdf";
import { learnBrandsFromManifest } from "@/lib/manifestBrand";
import { alreadyUploadedMessage, alreadyUploadedWhere, findAlreadyUploadedGuides, resolveGuideLines, type AlreadyUploadedGuide } from "@/lib/fulfillmentGuides";
import { getCurrentStockByItemIds } from "@/lib/stockKardex";

// Un PDF de ~280 páginas tarda ~2-3 s en leerse; con 40 PDF hace falta más
// de un minuto (pedido de Yair 2026-09-29: subir más de 20 de una vez).
export const maxDuration = 300;

const MAX_FILES = 40;
// warrantyFileUrls: los PDFs que Yair marcó como "Garantías" (Dropi los
// descarga en su propia sección, mismo formato — confirmado 2026-09-25).
const schema = z.object({ fileUrls: z.array(z.string().url()).min(1).max(MAX_FILES), warrantyFileUrls: z.array(z.string().url()).max(MAX_FILES).optional() });

// Confirmado 2026-09-23: lectura del PDF de guías de Dropi SIN IA — ver
// src/lib/dropiGuidesPdf.ts. Solo lee y propone; no guarda nada (eso es
// ./apply, después de que Yair revisa).
export async function POST(req: NextRequest) {
  if (!(await canSubmitFulfillmentRequest())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: `Sube entre 1 y ${MAX_FILES} PDF de guías.` }, { status: 400 });

  // Solo archivos de nuestro propio almacenamiento (subidos con uploadFile).
  const storageBase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!storageBase || parsed.data.fileUrls.some((u) => !u.startsWith(storageBase))) {
    return NextResponse.json({ error: "Archivo no válido." }, { status: 400 });
  }

  // Se descargan todos a la vez (con muchos PDF, uno por uno tardaba demasiado);
  // la lectura sigue en orden para que los avisos digan "PDF #n" correcto.
  const downloads = await Promise.all(
    parsed.data.fileUrls.map(async (url) => {
      const res = await fetch(url).catch(() => null);
      return res?.ok ? new Uint8Array(await res.arrayBuffer()) : null;
    })
  );
  // El texto de cada PDF se extrae una sola vez (es lo lento) — la lectura
  // puede repetirse sin las guías que ya estaban en otro corte (abajo).
  const filePages: PdfLine[][][] = [];
  for (const [idx, bytes] of downloads.entries()) {
    if (!bytes) return NextResponse.json({ error: `No se pudo abrir el PDF #${idx + 1}.` }, { status: 400 });
    try {
      filePages.push(await extractPages(bytes));
    } catch {
      return NextResponse.json({ error: `El archivo #${idx + 1} no parece un PDF válido.` }, { status: 400 });
    }
  }

  let read = readFiles(parsed.data.fileUrls, filePages, parsed.data.warrantyFileUrls ?? [], new Set());
  if (read.error) return NextResponse.json({ error: read.error }, { status: 400 });

  // Pedido del usuario 2026-10-06: si Dropi vuelve a poner en el PDF una guía
  // que ya salió en otro corte (caso 189908172), se quita sola y queda
  // constancia en los avisos del corte (parseWarnings). Solo si sus productos
  // se leyeron (si no, no se sabría cuánto restar) y si el PDF trae guías
  // nuevas; si todo ya se subió, o no se puede quitar, se frena como antes.
  const already = await findAlreadyUploadedGuides([...read.guides.keys()]);
  const removable = already.length > 0 && already.length < read.guides.size && already.every((a) => read.guides.get(a.number)?.removable);
  if (already.length > 0 && !removable) {
    return NextResponse.json({ error: alreadyUploadedMessage(already, read.guides.size) }, { status: 409 });
  }
  if (removable) {
    const before = read.guides;
    read = readFiles(parsed.data.fileUrls, filePages, parsed.data.warrantyFileUrls ?? [], new Set(already.map((a) => a.number)));
    if (read.error) return NextResponse.json({ error: read.error }, { status: 400 });
    read.warnings.unshift(...already.map((a) => removedGuideNote(a, before.get(a.number))));
  }
  const { merged, warranty, unreadWarranty, uncertainWarranty, warnings, guides, manifestDate } = read;

  // Cada PDF de Dropi es el manifiesto de una marca: el sistema aprende
  // solo la marca de los IDs (combos sobre todo) que aún no la tienen —
  // ver lib/manifestBrand.ts. Nunca frena la subida si algo falla.
  for (const codes of read.dropiCodesByFile) await learnBrandsFromManifest(codes).catch(() => null);

  // Un código que solo aparece en una garantía también necesita saber qué
  // producto es — entra a la lista con cantidad normal 0.
  for (const w of warranty) {
    if (!merged.has(w.code)) merged.set(w.code, { code: w.code, name: w.name, quantity: 0, byCarrier: {}, variants: [], labelUnits: 0 });
  }

  const rows = await resolveGuideLines([...merged.values()].sort((a, b) => b.quantity - a.quantity));

  // Stock actual de INVESTOCK de cada producto real involucrado — para el
  // aviso temprano (lo que no alcanza sale en rojo antes de enviar).
  const ids = new Set<string>();
  for (const r of rows) {
    if (r.resolution.kind === "product") ids.add(r.resolution.catalogItem.id);
    if (r.resolution.kind === "combo") for (const c of r.resolution.components) ids.add(c.catalogItem.id);
    if (r.resolution.kind === "unknown" && r.resolution.suggestion) ids.add(r.resolution.suggestion.id);
  }
  const stock = await getCurrentStockByItemIds([...ids]);

  return NextResponse.json({
    manifestDate,
    carriers: [...new Set([...guides.values()].map((g) => g.carrier))].filter(Boolean),
    guides: [...guides.entries()].map(([number, g]) => ({ number, carrier: g.carrier, warranty: g.warranty, codes: g.codes, sender: g.sender })),
    rows,
    warranty,
    unreadWarrantyGuides: unreadWarranty,
    uncertainWarrantyGuides: uncertainWarranty,
    warnings,
    stockByItem: Object.fromEntries([...ids].map((id) => [id, stock.get(id)?.balance ?? 0])),
  });
}

type GuideInfo = { carrier: string; warranty: boolean; codes: string[]; sender: string | null; removable: boolean; names: string[] };

// Lee todos los PDF de la subida y los junta (sin tocar la base). `exclude`:
// guías que ya están en otro corte y se quitan (solo PDF de Dropi).
function readFiles(fileUrls: string[], filePages: PdfLine[][][], warrantyFileUrls: string[], exclude: Set<string>) {
  const merged = new Map<string, ParsedGuidesLine>();
  const warranty: ParsedWarrantyLine[] = [];
  const unreadWarranty: string[] = [];
  const uncertainWarranty: string[] = [];
  const warnings: string[] = [];
  const guides = new Map<string, GuideInfo>();
  const repeatedInUpload: string[] = [];
  const dropiCodesByFile: string[][] = [];
  let manifestDate: string | null = null;
  const emptyFiles: number[] = [];
  const result = (error: string | null) => ({ error, merged, warranty, unreadWarranty, uncertainWarranty, warnings, guides, manifestDate, dropiCodesByFile });

  for (const [idx, url] of fileUrls.entries()) {
    // Dropi o Rocket — se reconoce solo (confirmado 2026-09-25: Yair sube
    // solo PDFs, también las etiquetas de Rocket en vez del Excel).
    const r = parseGuidesPages(filePages[idx], { warrantyFile: warrantyFileUrls.includes(url), excludeGuides: exclude });
    if (r.lines.length === 0 && r.warranty.length === 0) emptyFiles.push(idx + 1);
    manifestDate = manifestDate ?? r.manifestDate;
    for (const g of r.guides) {
      if (guides.has(g.number)) repeatedInUpload.push(g.number);
      else
        guides.set(g.number, {
          carrier: g.carrier,
          warranty: g.warranty,
          codes: g.codes,
          sender: g.sender ?? null,
          // Se puede quitar sola solo si es de Dropi y se leyó qué productos trae.
          removable: r.source === "DROPI" && g.codes.length > 0,
          names: (r.guideUnits[g.number] ?? []).map((u) => `${u.units} ${u.name}`),
        });
    }
    if (r.source === "DROPI") dropiCodesByFile.push([...r.lines.map((l) => l.code), ...r.warranty.map((w) => w.code)]);
    warranty.push(...r.warranty);
    unreadWarranty.push(...r.unreadWarrantyGuides);
    uncertainWarranty.push(...r.uncertainWarrantyGuides);
    const label = fileUrls.length > 1 ? `PDF #${idx + 1}: ` : "";
    warnings.push(...r.warnings.map((w) => label + w));
    for (const l of r.lines) {
      const prev = merged.get(l.code);
      if (!prev) {
        merged.set(l.code, { ...l, byCarrier: {}, quantity: 0, labelUnits: 0, labelUnitsByCarrier: l.labelUnitsByCarrier && {}, variants: [] });
        addGuidesLine(merged.get(l.code)!, l);
        continue;
      }
      addGuidesLine(prev, l);
    }
  }

  // Etiqueta de Gintracom de Rocket (sin ID, "RN:<nombre>") que vino en otro
  // PDF que el producto con ID: se suma a ese producto por nombre (caso real
  // 2026-09-26: el closet salía una vez con R14487 y otra "sin ID").
  const rocketIdByNameCode = new Map<string, string>();
  for (const l of merged.values()) if (/^R\d+$/.test(l.code)) rocketIdByNameCode.set(rocketNameCode(l.name), l.code);
  for (const [code, l] of [...merged.entries()]) {
    const target = code.startsWith(ROCKET_NAME_PREFIX) ? merged.get(rocketIdByNameCode.get(code) ?? "") : undefined;
    if (!target) continue;
    addGuidesLine(target, l);
    merged.delete(code);
  }
  for (const w of warranty) if (w.code.startsWith(ROCKET_NAME_PREFIX)) w.code = rocketIdByNameCode.get(w.code) ?? w.code;

  if (emptyFiles.length > 0) {
    return result(`No encontré la lista de productos en el PDF #${emptyFiles.join(", #")}. ¿Es el PDF de guías de Dropi o el de etiquetas de Rocket?`);
  }
  if (repeatedInUpload.length > 0) {
    return result(`Subiste el mismo PDF (o guías repetidas) más de una vez — ej. guía ${repeatedInUpload[0]}. Quita el duplicado.`);
  }
  return result(null);
}

// Constancia de la guía quitada: sale en la revisión y queda guardada con el
// corte (parseWarnings).
function removedGuideNote(a: AlreadyUploadedGuide, g: GuideInfo | undefined): string {
  const carrier = g?.carrier ? ` (${g.carrier.charAt(0)}${g.carrier.slice(1).toLowerCase()})` : "";
  const products = g?.names.length ? ` con ${g.names.join(", ")}` : "";
  return `Guía ${a.number}${carrier}${products} QUITADA de este corte: ya había salido en el ${alreadyUploadedWhere(a)}. Por qué: Dropi la volvió a poner en este PDF. Qué hacer: nada — no se vuelve a sumar ni a descontar.`;
}
