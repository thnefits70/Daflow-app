// Cálculos puros para los KPIs de inventario (boceto aprobado 2026-08-04) —
// sin Prisma, para poder usarse tanto en el ensamblado server-side como en
// componentes cliente que necesiten recomputar algo al vuelo.

// Reemplaza por completo el mecanismo trimestral manual (confirmado
// 2026-08-05) — cada mes Daniel sube un Excel con el stock valorizado por
// SKU. "Sin movimiento" se deriva solo comparando el stock de cada producto
// contra el mes inmediatamente anterior en que se subió información para
// ese SKU: si NO bajó, cuenta como un mes más sin moverse. No hay venta por
// SKU en el sistema — esto es un proxy transparente, no una medición exacta.

export type ProductSnapshotRow = {
  period: string; // "YYYY-MM"
  productCode: string;
  description: string;
  avgCost: number;
  stock: number;
  costTotal: number;
};

export type StaleStreakBucket = "1" | "2-3" | "4+";

export function staleStreakBucket(streakMonths: number): StaleStreakBucket {
  if (streakMonths >= 4) return "4+";
  if (streakMonths >= 2) return "2-3";
  return "1";
}

export type StaleStreakEntry = {
  productCode: string;
  description: string;
  avgCost: number;
  stock: number;
  costTotal: number;
  streakMonths: number;
  bucket: StaleStreakBucket;
  trend: "up" | "flat" | "down";
};

// Recibe TODO el historial de snapshots de un departamento (todas las
// filas, todos los meses) y calcula, para el mes más reciente cargado, qué
// productos llevan racha sin bajar de stock. Cada producto se compara solo
// contra su propio historial (no todos los SKU aparecen en todos los meses
// — ej. productos nuevos o descontinuados), ordenado por período ascendente.
export function computeStaleStreaks(allRows: ProductSnapshotRow[]): StaleStreakEntry[] {
  const byProduct = new Map<string, ProductSnapshotRow[]>();
  for (const r of allRows) {
    const arr = byProduct.get(r.productCode) ?? [];
    arr.push(r);
    byProduct.set(r.productCode, arr);
  }

  const entries: StaleStreakEntry[] = [];
  for (const rows of byProduct.values()) {
    const sorted = [...rows].sort((a, b) => a.period.localeCompare(b.period));
    const latest = sorted[sorted.length - 1];
    const previous = sorted.length >= 2 ? sorted[sorted.length - 2] : null;

    if (!previous) continue; // primer mes de este SKU — nada con qué comparar todavía
    if (latest.stock < previous.stock) continue; // bajó de stock — hay evidencia de venta, no está "sin movimiento"

    let streak = 0;
    let i = sorted.length - 1;
    while (i > 0 && sorted[i].stock >= sorted[i - 1].stock) {
      streak++;
      i--;
    }

    const trend: StaleStreakEntry["trend"] = latest.stock > previous.stock ? "up" : latest.stock < previous.stock ? "down" : "flat";

    entries.push({
      productCode: latest.productCode,
      description: latest.description,
      avgCost: latest.avgCost,
      stock: latest.stock,
      costTotal: latest.costTotal,
      streakMonths: streak,
      bucket: staleStreakBucket(streak),
      trend,
    });
  }

  return entries.sort((a, b) => b.streakMonths - a.streakMonths || b.costTotal - a.costTotal);
}

export function summarizeStaleStreaks(entries: StaleStreakEntry[], totalPeriodValue: number | null) {
  const bucket1 = entries.filter((e) => e.bucket === "1");
  const bucket23 = entries.filter((e) => e.bucket === "2-3");
  const bucket4plus = entries.filter((e) => e.bucket === "4+");
  const totalStaleValue = entries.reduce((s, e) => s + e.costTotal, 0);
  const pct = totalPeriodValue && totalPeriodValue > 0 ? (totalStaleValue / totalPeriodValue) * 100 : null;
  return {
    bucket1,
    bucket23,
    bucket4plus,
    totalStaleValue,
    totalStalePct: pct,
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
