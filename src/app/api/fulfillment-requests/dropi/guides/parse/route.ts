import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { canSubmitFulfillmentRequest } from "@/lib/guards";
import { parseDropiGuidesPdf, type ParsedGuidesLine, type ParsedWarrantyLine } from "@/lib/dropiGuidesPdf";
import { findAlreadyUploadedGuides, resolveGuideLines } from "@/lib/fulfillmentGuides";
import { getCurrentStockByItemIds } from "@/lib/stockKardex";

// Un PDF de ~280 páginas tarda ~2-3 s en leerse; margen de sobra.
export const maxDuration = 60;

const MAX_FILES = 10;
const schema = z.object({ fileUrls: z.array(z.string().url()).min(1).max(MAX_FILES) });

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

  const merged = new Map<string, ParsedGuidesLine>();
  const warranty: ParsedWarrantyLine[] = [];
  const unreadWarranty: string[] = [];
  const guides = new Map<string, { carrier: string; warranty: boolean }>();
  const repeatedInUpload: string[] = [];
  let manifestDate: string | null = null;
  const emptyFiles: number[] = [];

  for (const [idx, url] of parsed.data.fileUrls.entries()) {
    const res = await fetch(url);
    if (!res.ok) return NextResponse.json({ error: `No se pudo abrir el PDF #${idx + 1}.` }, { status: 400 });
    let result;
    try {
      result = await parseDropiGuidesPdf(new Uint8Array(await res.arrayBuffer()));
    } catch {
      return NextResponse.json({ error: `El archivo #${idx + 1} no parece un PDF válido.` }, { status: 400 });
    }
    if (result.lines.length === 0 && result.warranty.length === 0) emptyFiles.push(idx + 1);
    manifestDate = manifestDate ?? result.manifestDate;
    for (const g of result.guides) {
      if (guides.has(g.number)) repeatedInUpload.push(g.number);
      else guides.set(g.number, { carrier: g.carrier, warranty: g.warranty });
    }
    warranty.push(...result.warranty);
    unreadWarranty.push(...result.unreadWarrantyGuides);
    for (const l of result.lines) {
      const prev = merged.get(l.code);
      if (!prev) {
        merged.set(l.code, { ...l, byCarrier: { ...l.byCarrier }, variants: [...l.variants] });
        continue;
      }
      prev.quantity += l.quantity;
      prev.labelUnits += l.labelUnits;
      for (const [c, q] of Object.entries(l.byCarrier)) prev.byCarrier[c] = (prev.byCarrier[c] ?? 0) + q;
      for (const v of l.variants) {
        const same = prev.variants.find((x) => x.label === v.label);
        if (same) same.quantity += v.quantity;
        else prev.variants.push({ ...v });
      }
    }
  }

  if (emptyFiles.length > 0) {
    return NextResponse.json(
      { error: `No encontré la lista de productos en el PDF #${emptyFiles.join(", #")}. ¿Es el PDF de guías que descargas de Dropi (con la tabla "PRODUCTOS")?` },
      { status: 400 }
    );
  }
  if (repeatedInUpload.length > 0) {
    return NextResponse.json({ error: `Subiste el mismo PDF (o guías repetidas) más de una vez — ej. guía ${repeatedInUpload[0]}. Quita el duplicado.` }, { status: 400 });
  }

  const already = await findAlreadyUploadedGuides([...guides.keys()]);
  if (already.length > 0) {
    const when = already[0].requestedAt.toLocaleString("es-EC", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Guayaquil" });
    return NextResponse.json(
      { error: `${already.length} de estas guías ya se subieron el ${when} (ej. ${already[0].number}) — este PDF ya está en un corte, no se vuelve a sumar.` },
      { status: 409 }
    );
  }

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
    guides: [...guides.entries()].map(([number, g]) => ({ number, carrier: g.carrier, warranty: g.warranty })),
    rows,
    warranty,
    unreadWarrantyGuides: unreadWarranty,
    stockByItem: Object.fromEntries([...ids].map((id) => [id, stock.get(id)?.balance ?? 0])),
  });
}
