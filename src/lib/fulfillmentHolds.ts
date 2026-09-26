// Pedido de Daniel 2026-09-26: cuando falta stock de un producto del corte,
// DAFLOW decide qué guías se quedan sin despachar y se lo dice a
// Fulfillment. Se retienen primero las de la transportadora que sale AL
// ÚLTIMO (Servientrega, luego Laar, Gintracom, Urbano, Veloces), así lo que
// se va antes sale completo. Ej. real: 132535 pedido 17 (Veloces 4,
// Gintracom 12, Servientrega 1), sacado 15 → se retienen 1 de Servientrega
// y 1 de Gintracom.
// Mismo orden que confirmPicks (fulfillmentPicking.ts): lo que sale cubre
// primero el despacho normal, así que lo que falta cae primero en las
// garantías (esas sí tienen número de guía guardado).
// Archivo sin dependencias de servidor — lo usan la pantalla y el aviso.
import { sortCarriers } from "./carriers";

type PickIn = {
  catalogItemId: string;
  name: string;
  justCode: string | null;
  needed: number;
  normalNeeded: number;
  warrantyNeeded: number;
  picked: number | null;
  confirmedQty: number | null;
  confirmedAt: unknown;
};
type LineIn = { catalogItemId: string; byCarrier: Record<string, number> };
type WarrantyIn = { catalogItemId: string; guide: string; carrier: string; quantity: number; mode: string };

export type GuideHold = {
  catalogItemId: string;
  name: string;
  justCode: string | null;
  needed: number;
  out: number;
  missing: number;
  // true = Daniel ya confirmó lo que salió; false = según lo que registró el
  // equipo (todavía puede cambiar).
  final: boolean;
  warrantyGuides: { guide: string; carrier: string; qty: number }[];
  byCarrier: { carrier: string; qty: number }[];
};

const lastFirst = (carriers: string[]) => sortCarriers(carriers).reverse();

export function computeGuideHolds(lot: { picking: PickIn[]; lines: LineIn[]; warranty: WarrantyIn[] }): GuideHold[] {
  const holds: GuideHold[] = [];
  for (const p of lot.picking) {
    const final = p.confirmedAt != null;
    const out = final ? (p.confirmedQty ?? 0) : p.picked;
    // Nadie registró todavía: no se sabe si falta.
    if (out == null) continue;
    const missing = p.needed - Math.min(out, p.needed);
    if (missing <= 0) continue;

    let left = missing;
    const warrantyGuides: GuideHold["warrantyGuides"] = [];
    const ws = lot.warranty.filter((w) => w.catalogItemId === p.catalogItemId && w.mode !== "PIECE");
    const wOrder = lastFirst([...new Set(ws.map((w) => w.carrier))]);
    ws.sort((a, b) => wOrder.indexOf(a.carrier) - wOrder.indexOf(b.carrier) || a.guide.localeCompare(b.guide));
    for (const w of ws) {
      if (left <= 0) break;
      const qty = Math.min(left, w.quantity);
      warrantyGuides.push({ guide: w.guide, carrier: w.carrier, qty });
      left -= qty;
    }

    const byCarrier: GuideHold["byCarrier"] = [];
    const line = lot.lines.find((l) => l.catalogItemId === p.catalogItemId);
    if (line) {
      for (const carrier of lastFirst(Object.keys(line.byCarrier))) {
        if (left <= 0) break;
        const qty = Math.min(left, line.byCarrier[carrier] ?? 0);
        if (qty <= 0) continue;
        byCarrier.push({ carrier, qty });
        left -= qty;
      }
    }
    holds.push({ catalogItemId: p.catalogItemId, name: p.name, justCode: p.justCode, needed: p.needed, out, missing, final, warrantyGuides, byCarrier });
  }
  return holds;
}

// "1 de Servientrega y 1 de Gintracom" / "la garantía 745… (Servientrega)".
export function holdSummary(h: GuideHold, label: (carrier: string) => string): string {
  const parts = [
    ...h.byCarrier.map((c) => `${c.qty} de ${label(c.carrier)}`),
    ...h.warrantyGuides.map((w) => `la garantía ${w.guide} (${label(w.carrier)}${w.qty > 1 ? `, ${w.qty} u.` : ""})`),
  ];
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}`;
}
