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
