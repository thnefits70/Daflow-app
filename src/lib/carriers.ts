// Confirmado 2026-09-23 con el usuario: transportadoras con las que se
// despacha (Rocket NO es transportadora — es una plataforma como Dropi, y
// despacha por Servientrega/Gintracom). Orden del manifiesto impreso:
// primero las que menos veces recogen en el día (si se pierde su camión el
// pedido se atrasa hasta el día siguiente). Archivo sin dependencias de
// servidor — lo usan tanto las rutas como la pantalla.
export const CARRIER_ORDER = ["VELOCES", "URBANO", "GINTRACOM", "LAAR", "SERVIENTREGA"];
export const NO_CARRIER = "SIN TRANSPORTADORA";

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

// Productos del corte ordenados por bloque y, dentro de cada uno, de mayor a
// menor cantidad — el mismo orden en el manifiesto impreso y en la pantalla.
export function sortByBlock<T extends { byCarrier: Record<string, number>; quantity: number }>(lines: T[]): T[] {
  const order = sortCarriers([...new Set(lines.map((l) => lineBlock(l.byCarrier)))]);
  return [...lines].sort((a, b) => order.indexOf(lineBlock(a.byCarrier)) - order.indexOf(lineBlock(b.byCarrier)) || b.quantity - a.quantity);
}
