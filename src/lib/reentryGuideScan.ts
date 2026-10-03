import { prisma } from "@/lib/prisma";
import { CARRIER_GUIDE_FORMATS, splitGuideBuffer } from "@/lib/cancelledGuidesLabels";
import { lookupGuide } from "@/lib/localWarranty";
import { costOfKardexOutEntries } from "@/lib/sellingCost";
import { formatMerchandiseReentryCode } from "@/lib/merchandiseReentry";

// Pedido del usuario 2026-10-02: el Reingreso de Mercadería se hace
// escaneando la guía de cada devolución (la que vuelve trae el mismo número
// y código de barras con que salió). Con la guía, DAFLOW sabe qué productos
// y cuántos venían, y el costo real de esas unidades (el de la compra de la
// que salieron el día del despacho). Joel solo escanea; al final marca lo
// dañado. Si la guía no se puede usar, se dice por qué y SOLO ahí se
// habilita registrar a mano (respaldo, costo promedio del Kardex).

export type ScanFailure = { ok: false; reason: string; allowManual: boolean };
export type ScanSuccess = { ok: true; guideId: string; guideNumber: string; units: number; warnings: string[] };

const dateFmt = (d: Date) => d.toLocaleDateString("es-EC", { day: "2-digit", month: "2-digit", timeZone: "America/Guayaquil" });

// Lo que leyó el escáner puede traer guiones/espacios o algo pegado al
// número: se prueban el texto limpio y cualquier número de guía con el
// formato de una transportadora que aparezca adentro.
export function guideCandidates(raw: string): string[] {
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const out = new Set<string>();
  if (!clean) return [];
  out.add(clean);
  for (const g of splitGuideBuffer(clean).extracted) out.add(g.guideNumber);
  for (const f of CARRIER_GUIDE_FORMATS) {
    for (let i = clean.indexOf(f.prefix); i >= 0; i = clean.indexOf(f.prefix, i + 1)) {
      const cand = clean.slice(i, i + f.length);
      if (cand.length === f.length) out.add(cand);
    }
  }
  return [...out];
}

function looksLikeGuide(candidates: string[]): boolean {
  return candidates.some((c) => CARRIER_GUIDE_FORMATS.some((f) => c.startsWith(f.prefix) && c.length === f.length));
}

export async function scanGuideIntoBatch(params: { batchId: string; raw: string; typedByHand: boolean }): Promise<ScanSuccess | ScanFailure> {
  const candidates = guideCandidates(params.raw);
  const shown = params.raw.trim().slice(0, 40);
  if (candidates.length === 0) return { ok: false, reason: "No se leyó ningún número. Vuelve a escanear el código de barras de la guía.", allowManual: false };

  // 1. Ya reingresada (en este lote o en otro).
  const already = await prisma.merchandiseReentryGuide.findFirst({
    where: { guideNumber: { in: candidates } },
    select: { guideNumber: true, batchId: true, createdAt: true, batch: { select: { batchNumber: true } } },
  });
  if (already) {
    return already.batchId === params.batchId
      ? { ok: false, reason: `Ya escaneaste la guía ${already.guideNumber} en este lote. No se suma dos veces.`, allowManual: false }
      : { ok: false, reason: `La guía ${already.guideNumber} ya se reingresó el ${dateFmt(already.createdAt)} en el lote ${formatMerchandiseReentryCode(already.batch.batchNumber)}. No se suma dos veces.`, allowManual: false };
  }

  // 2. Reportada como guía cancelada: vuelve a INVESTOCK por ese otro camino.
  const cancelled = await prisma.cancelledGuideReport.findFirst({ where: { guideNumber: { in: candidates } }, select: { guideNumber: true, code: true } });
  if (cancelled) {
    return { ok: false, reason: `La guía ${cancelled.guideNumber} se reportó como guía cancelada (${cancelled.code}). Esa mercadería vuelve a INVESTOCK por Guías canceladas, no por aquí, para no sumarla dos veces.`, allowManual: false };
  }

  // 3. Registrada en DAFLOW (guías de los cortes, desde el 26/9).
  const found = await prisma.fulfillmentRequestGuide.findMany({
    where: { guideNumber: { in: candidates } },
    select: { guideNumber: true, carrier: true, batch: { select: { lot: { select: { day: true, status: true, despachoOutflowBatchId: true, garantiaOutflowBatchId: true } } } } },
  });
  if (found.length === 0) {
    if (!looksLikeGuide(candidates)) {
      return { ok: false, reason: `Lo que se leyó (${shown}) no es un número de guía de ninguna transportadora. Vuelve a escanear el código de barras de la guía, no otro código del paquete.`, allowManual: false };
    }
    return { ok: false, reason: `La guía ${shown} no está registrada en DAFLOW. DAFLOW guarda las guías que salen desde el 26/9, así que esta seguramente salió antes. Regístrala a mano.`, allowManual: true };
  }
  if (found.length > 1) return { ok: false, reason: `Lo que se leyó (${shown}) coincide con más de una guía. Vuelve a escanear solo el código de barras del número de guía.`, allowManual: false };
  const row = found[0];
  const lot = row.batch.lot;
  if (!lot || lot.status === "DRAFT") {
    return { ok: false, reason: `La guía ${row.guideNumber} está en un corte que todavía no se envió a bodega: para DAFLOW nunca salió. Avísale a Daniel; si de verdad regresó, regístrala a mano.`, allowManual: true };
  }

  // 4. Qué productos y cuántos traía (del PDF guardado de ese corte).
  const looked = await lookupGuide(row.guideNumber, { productsOnly: true });
  if (!looked.ok) return { ok: false, reason: `${looked.error} Regístrala a mano.`, allowManual: true };
  const src = looked.source;
  const unresolved = src.unresolved ?? [];
  if (src.lines.length === 0 && unresolved.length === 0 && src.warnings.some((w) => w.includes("no salió en el corte"))) {
    return { ok: false, reason: `La guía ${row.guideNumber} no llevó ningún producto que haya salido de bodega (${src.warnings.join(" ")}). Si llegó algo físico, regístralo a mano.`, allowManual: true };
  }
  if (src.lines.length === 0 && unresolved.length === 0) {
    return { ok: false, reason: `No se pudo leer qué productos traía la guía ${row.guideNumber} en el PDF guardado del corte. Regístrala a mano.`, allowManual: true };
  }

  // 5. Costo real: las salidas del Kardex de ese corte para cada producto.
  const outflowBatchIds = [lot.despachoOutflowBatchId, lot.garantiaOutflowBatchId].filter((x): x is string => !!x);
  const warnings = [...src.warnings];
  if (params.typedByHand) warnings.unshift("Número de guía escrito a mano (la etiqueta no se pudo leer).");
  const costs = new Map<string, number | null>();
  for (const line of src.lines) {
    const outItems = outflowBatchIds.length
      ? await prisma.merchandiseOutflowItem.findMany({
          where: { batchId: { in: outflowBatchIds }, catalogItemId: line.catalogItemId },
          select: { stockKardexEntry: { select: { id: true } } },
        })
      : [];
    const entryIds = outItems.map((o) => o.stockKardexEntry?.id).filter((x): x is string => !!x);
    // Pedido del usuario 2026-10-03: si no se encuentra la salida, NO se le
    // avisa a Joel (es un dato de costo, no le sirve al escanear). Queda
    // registrado igual: unitCost null = vuelve al costo promedio del Kardex.
    const cost = await costOfKardexOutEntries(line.catalogItemId, entryIds);
    costs.set(line.catalogItemId, cost);
  }

  try {
    const guide = await prisma.merchandiseReentryGuide.create({
      data: {
        batchId: params.batchId,
        guideNumber: row.guideNumber,
        carrier: row.carrier,
        shippedDay: src.shippedAt.slice(0, 10),
        warnings,
        items: {
          create: [
            ...src.lines.map((l) => ({
              batchId: params.batchId,
              photoUrls: [],
              catalogItemId: l.catalogItemId,
              aiRecognized: true,
              goodQty: l.quantity,
              unitCost: costs.get(l.catalogItemId) ?? null,
            })),
            // Código sin producto de INVESTOCK: entra sin identificar y Daniel
            // lo vincula en Revisión (como un producto puesto a mano).
            ...unresolved.map((u) => ({
              batchId: params.batchId,
              photoUrls: [],
              catalogItemId: null,
              aiRecognized: false,
              declaredName: `${u.name} (código ${u.code})`.slice(0, 200),
              goodQty: u.quantity,
            })),
          ],
        },
      },
      select: { id: true, guideNumber: true },
    });
    const units = src.lines.reduce((s, l) => s + l.quantity, 0) + unresolved.reduce((s, u) => s + u.quantity, 0);
    return { ok: true, guideId: guide.id, guideNumber: guide.guideNumber, units, warnings };
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return { ok: false, reason: `La guía ${row.guideNumber} ya se acaba de escanear. No se suma dos veces.`, allowManual: false };
    throw e;
  }
}

// Al enviar un lote escaneado: lo que Joel marcó como dañado por producto se
// descuenta de las buenas de las guías de ese producto (empezando por la
// última escaneada) y la fila de dañadas toma el costo de esas guías. Corre
// dentro de la transacción del envío.
export async function applyScanDamage(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], batchId: string): Promise<string | null> {
  const damageRows = await tx.merchandiseReentryItem.findMany({ where: { batchId, scanDamage: true }, select: { id: true, catalogItemId: true, damagedQty: true } });
  for (const d of damageRows) {
    if (!d.catalogItemId || d.damagedQty <= 0) continue;
    const guideItems = await tx.merchandiseReentryItem.findMany({
      where: { batchId, guideId: { not: null }, catalogItemId: d.catalogItemId },
      select: { id: true, goodQty: true, unitCost: true },
      orderBy: { createdAt: "desc" },
    });
    const available = guideItems.reduce((s, i) => s + i.goodQty, 0);
    if (available < d.damagedQty) return "Marcaste más dañadas que las unidades escaneadas de un producto. Revisa las dañadas antes de enviar.";
    const withCost = guideItems.filter((i) => i.unitCost != null);
    const cost = withCost.length ? withCost.reduce((s, i) => s + i.goodQty * i.unitCost!, 0) / withCost.reduce((s, i) => s + i.goodQty, 0) : null;
    let left = d.damagedQty;
    for (const g of guideItems) {
      if (left <= 0) break;
      const take = Math.min(left, g.goodQty);
      if (take > 0) await tx.merchandiseReentryItem.update({ where: { id: g.id }, data: { goodQty: g.goodQty - take } });
      left -= take;
    }
    await tx.merchandiseReentryItem.update({ where: { id: d.id }, data: { unitCost: Number.isFinite(cost) ? cost : null } });
  }
  return null;
}
