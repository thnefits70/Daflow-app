// Cálculos puros para los KPIs de inventario (boceto aprobado 2026-08-04) —
// sin Prisma, para poder usarse tanto en el ensamblado server-side como en
// componentes cliente que necesiten recomputar algo al vuelo.

export function quarterOf(d: Date): string {
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `${d.getFullYear()}-Q${q}`;
}

export function currentQuarter(): string {
  return quarterOf(new Date());
}

// Primer día del trimestre SIGUIENTE al indicado — usado para saber cuándo
// vence la próxima reconfirmación de un producto sin movimiento.
export function nextQuarterStart(quarter: string): Date {
  const [yStr, qStr] = quarter.split("-Q");
  const y = Number(yStr);
  const q = Number(qStr);
  const nextQ = q === 4 ? 1 : q + 1;
  const nextY = q === 4 ? y + 1 : y;
  return new Date(nextY, (nextQ - 1) * 3, 1);
}

export function daysUntilDue(lastConfirmedQuarter: string): number {
  const due = nextQuarterStart(lastConfirmedQuarter);
  const now = new Date();
  return Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

export function isReviewDue(lastConfirmedQuarter: string): boolean {
  return currentQuarter() !== lastConfirmedQuarter;
}

const QUARTER_MONTH_NAMES = ["Ene-Mar", "Abr-Jun", "Jul-Sep", "Oct-Dic"];
export function quarterLabel(quarter: string): string {
  const [y, qStr] = quarter.split("-Q");
  const q = Number(qStr);
  return `${QUARTER_MONTH_NAMES[q - 1] ?? quarter} ${y}`;
}

// 1 trimestre confirmado = recién cruzó el umbral (3-6 meses aprox.);
// 2 o más = ya lleva +6 meses sin venderse. Solo aplica a productos activos
// (no recuperados) — confirmado 2026-08-04, Daniel nunca elige el rango,
// se deriva solo de cuántas veces seguidas confirmó "sigue igual".
export function staleBucket(quartersConfirmed: number): "3-6" | "6+" {
  return quartersConfirmed >= 2 ? "6+" : "3-6";
}

export type StaleProductRow = { id: string; name: string; value: number; status: string; quartersConfirmed: number };

export function summarizeStaleProducts(products: StaleProductRow[], totalInventoryValue: number | null) {
  const active = products.filter((p) => p.status === "active");
  const bucket36 = active.filter((p) => staleBucket(p.quartersConfirmed) === "3-6");
  const bucket6plus = active.filter((p) => staleBucket(p.quartersConfirmed) === "6+");
  const value36 = bucket36.reduce((s, p) => s + p.value, 0);
  const value6plus = bucket6plus.reduce((s, p) => s + p.value, 0);
  const totalStale = value36 + value6plus;
  const pct = (v: number) => (totalInventoryValue && totalInventoryValue > 0 ? (v / totalInventoryValue) * 100 : null);
  return {
    bucket36,
    bucket6plus,
    value36,
    value6plus,
    totalStalePct: pct(totalStale),
    bucket36Pct: pct(value36),
    bucket6plusPct: pct(value6plus),
  };
}

// GMROI = utilidad bruta del mes ÷ inventario promedio (igual patrón que
// workingCapitalDays: promedia con el mes anterior cuando existe).
export function gmroi(utilidadBruta: number, currentInventory: number, previousInventory: number | null): number | null {
  const avg = previousInventory !== null ? (currentInventory + previousInventory) / 2 : currentInventory;
  if (avg === 0) return null;
  return utilidadBruta / avg;
}

// Dirección "buena" de cada métrica — DIO/rotación: bajar es bueno. GMROI:
// subir es bueno. Devuelve null si no hay mes anterior para comparar (sin
// tendencia, se pinta neutro en la UI).
export function trendIsGood(current: number, previous: number | null, goodDirection: "down" | "up"): boolean | null {
  if (previous === null) return null;
  if (current === previous) return null;
  return goodDirection === "down" ? current < previous : current > previous;
}

export type MonthlyInventorySalesPoint = { period: string; inventario: number; ventas: number };

// Alerta automática de sobrestock (KPI #2 del boceto): inventario sube 2
// meses seguidos mientras las ventas no acompañan (planas o cayendo) en el
// mismo tramo — confirmado 2026-08-04, sustituye "% de sobrestock" manual.
export function detectOverstockAlert(series: MonthlyInventorySalesPoint[]): { alert: boolean; message: string | null } {
  if (series.length < 3) return { alert: false, message: null };
  const last3 = series.slice(-3);
  const [a, b, c] = last3;
  const inventoryRising = b.inventario > a.inventario && c.inventario > b.inventario;
  const salesFlatOrFalling = c.ventas <= a.ventas * 1.02; // tolerancia de 2% de ruido
  if (inventoryRising && salesFlatOrFalling) {
    return {
      alert: true,
      message: "Inventario subió 2 meses seguidos mientras las ventas no acompañaron — posible sobrestock.",
    };
  }
  return { alert: false, message: null };
}
