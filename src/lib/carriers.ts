// Confirmado 2026-09-23 con el usuario: transportadoras con las que se
// despacha (Rocket NO es transportadora — es una plataforma como Dropi, y
// despacha por Servientrega/Gintracom). Orden del manifiesto impreso:
// primero las que menos veces recogen en el día (si se pierde su camión el
// pedido se atrasa hasta el día siguiente). Archivo sin dependencias de
// servidor — lo usan tanto las rutas como la pantalla.
import { areaRank } from "./warehouseAreas";

export const CARRIER_ORDER = ["VELOCES", "URBANO", "GINTRACOM", "LAAR", "SERVIENTREGA"];
export const NO_CARRIER = "SIN TRANSPORTADORA";
// Variante de un corte subido antes del 2026-09-29 cuyo PDF mezclaba
// transportadoras: no se sabe por cuál va (ver getCompiledLot).
export const VARIANT_CARRIER_UNKNOWN = "?";

const LABELS: Record<string, string> = {
  VELOCES: "Veloces",
  URBANO: "Urbano",
  GINTRACOM: "Gintracom",
  LAAR: "Laar",
  SERVIENTREGA: "Servientrega",
  [NO_CARRIER]: "Sin transportadora",
};

export function carrierLabel(c: string): string {
  return LABELS[c] ?? c.charAt(0) + c.slice(1).toLowerCase();
}

export function sortCarriers(carriers: string[]): string[] {
  const rank = (c: string) => {
    const i = CARRIER_ORDER.indexOf(c);
    return i === -1 ? CARRIER_ORDER.length : i;
  };
  return [...carriers].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

// Bloque del manifiesto de un producto (pedido de Daniel 2026-09-26): la
// transportadora que se va primero entre las que lo llevan. Todo el
// producto (también sus unidades de otras transportadoras) va en ese bloque.
export function lineBlock(byCarrier: Record<string, number>): string {
  return sortCarriers(Object.keys(byCarrier).filter((c) => (byCarrier[c] ?? 0) > 0))[0] ?? NO_CARRIER;
}

// En una lista ya ordenada con sortByBlock: ¿la fila i empieza un grupo de
// área nuevo (primera del bloque o área distinta a la anterior)? y cuántos
// productos tiene ese grupo — para los subtítulos "Área A · 3 productos".
type AreaLine = { byCarrier: Record<string, number>; area?: string | null };
export function newAreaGroup(lines: AreaLine[], i: number): boolean {
  if (i === 0) return true;
  const prev = lines[i - 1];
  return lineBlock(prev.byCarrier) !== lineBlock(lines[i].byCarrier) || (prev.area ?? null) !== (lines[i].area ?? null);
}
export function areaGroupCount(lines: AreaLine[], i: number): number {
  let n = 1;
  while (i + n < lines.length && !newAreaGroup(lines, i + n)) n++;
  return n;
}

// Productos del corte ordenados por bloque, dentro de cada uno por área de
// bodega (A…G, sin área al final — pedido del usuario 2026-09-26, para
// sacar junto lo que está en el mismo lugar) y luego de mayor a menor
// cantidad — el mismo orden en el manifiesto impreso y en la pantalla.
export function sortByBlock<T extends { byCarrier: Record<string, number>; quantity: number; area?: string | null }>(lines: T[]): T[] {
  const order = sortCarriers([...new Set(lines.map((l) => lineBlock(l.byCarrier)))]);
  return [...lines].sort(
    (a, b) => order.indexOf(lineBlock(a.byCarrier)) - order.indexOf(lineBlock(b.byCarrier)) || areaRank(a.area) - areaRank(b.area) || b.quantity - a.quantity
  );
}
