// Calculadora de ganancia de provedix.com (pedido del usuario 2026-10-15).
// Mismas fórmulas que la "Calculadora de Rentabilidad ECOMX" que mandó el
// usuario, más los costos administrativos de su primera calculadora
// (arriendo, sueldos, Shopify… divididos entre los pedidos):
//   entregados = (1 − %cancelación) × (1 − %devolución)
//   cancelado  → se pierde solo el CPA (no se despacha)
//   devuelto   → se pierde el CPA + 1 flete
//   precio     = unidades×costo + ganancia + (CPA + admin)/entregados + flete/(1 − %devolución), redondeado a .99
//   CPA máximo = entregados×(precio − unidades×costo) − flete×(1 − %cancelación) − admin
// Sin dependencias: se usa en la página y en las pruebas.

export type CalcInput = {
  units: number; // unidades por pedido
  unitCost: number; // precio en Dropi por unidad
  freight: number; // flete por pedido (1 solo)
  cpa: number; // costo de publicidad por pedido generado
  admin: number; // costos administrativos por pedido
  profit: number; // ganancia deseada por pedido entregado
  cancelPct: number; // 0–100
  returnPct: number; // 0–100
};

export type CalcStatus = "RENTABLE" | "EN_ALERTA" | "NO_RENTABLE";

export type CalcResult = {
  deliveredRate: number; // 0–1
  price: number; // recomendado, termina en .99
  minPrice: number; // con ganancia 0
  breakEvenCpa: number; // CPA máximo sin perder
  cpaRoom: number; // breakEvenCpa − cpa
  profitPerDelivered: number; // con el precio recomendado
  margin: number; // 0–1
  status: CalcStatus;
};

export const CALC_DEFAULTS: CalcInput = { units: 1, unitCost: 0, freight: 7, cpa: 5, admin: 0, profit: 5, cancelPct: 20, returnPct: 20 };

const roundTo99 = (x: number) => Math.ceil(x + 0.01) - 0.01;

function rawPrice(i: CalcInput, profit: number, m: number): number {
  return i.units * i.unitCost + profit + (i.cpa + i.admin) / m + i.freight / (1 - i.returnPct / 100);
}

export function calcProfit(i: CalcInput): CalcResult | null {
  const c = Math.min(Math.max(i.cancelPct, 0), 95) / 100;
  const r = Math.min(Math.max(i.returnPct, 0), 95) / 100;
  const m = (1 - c) * (1 - r);
  if (!(i.unitCost > 0) || !(i.units >= 1) || m <= 0) return null;
  const input = { ...i, cancelPct: c * 100, returnPct: r * 100 };
  const price = roundTo99(rawPrice(input, i.profit, m));
  const minPrice = roundTo99(rawPrice(input, 0, m));
  return { deliveredRate: m, price, minPrice, ...evaluate(input, price, m) };
}

// Con un precio dado (el que elige el dropshipper o el del mercado).
export function calcAtPrice(i: CalcInput, price: number): Omit<CalcResult, "price" | "minPrice" | "deliveredRate"> | null {
  const m = (1 - i.cancelPct / 100) * (1 - i.returnPct / 100);
  if (!(i.unitCost > 0) || !(price > 0) || m <= 0) return null;
  return evaluate(i, price, m);
}

function evaluate(i: CalcInput, price: number, m: number) {
  const r = i.returnPct / 100;
  const c = i.cancelPct / 100;
  const breakEvenCpa = m * (price - i.units * i.unitCost) - i.freight * (1 - c) - i.admin;
  const cpaRoom = breakEvenCpa - i.cpa;
  const profitPerDelivered = price - i.units * i.unitCost - (i.cpa + i.admin) / m - i.freight / (1 - r);
  const margin = profitPerDelivered / price;
  const status: CalcStatus = cpaRoom < 0 ? "NO_RENTABLE" : margin < 0.08 || cpaRoom < 0.5 ? "EN_ALERTA" : "RENTABLE";
  return { breakEvenCpa, cpaRoom, profitPerDelivered, margin, status };
}

// Embudo de 100 pedidos generados.
export function funnel(i: Pick<CalcInput, "cancelPct" | "returnPct">) {
  const cancelled = Math.round(100 * (i.cancelPct / 100));
  const sent = 100 - cancelled;
  const returned = Math.round(sent * (i.returnPct / 100));
  return { generated: 100, cancelled, sent, returned, delivered: sent - returned };
}
