import { prisma } from "@/lib/prisma";
import { getAutoReturnRateMonths } from "@/lib/returnRate";
import { isAutoReturnRateMonth } from "@/lib/returnRateConstants";
import { getMonthDispatchSummary } from "@/lib/commissionTiers";
import { prevMonthStr } from "@/lib/pendingTasks";
import { computeAutoStockoutWeeks, isAutoStockoutWeek } from "@/lib/autoStockout";
import { isAutoFillRateWeek, isoWeekOf } from "@/lib/autoFillRate";
import { brandLabel, sortBrands } from "@/lib/brandLabels";
import { guideBrandsOf } from "@/lib/guideBrands";
import { NO_BRAND, ecuadorDay } from "@/lib/fulfillmentGuides";
import { getLocalWarrantyReasonCounts, getWarrantyRate, previousMonth, warrantyReasonGroup, type WarrantyReasonGroup } from "@/lib/warrantyInsights";

function pct(a: number, b: number) {
  return b === 0 ? 0 : Math.round((a / b) * 100);
}

export type DashboardRow = {
  dept: { id: string; name: string; code: string };
  procs: number;
  docs: number;
  examCount: number;
  attempts: number;
  avg: number | null;
  ranking: { user: string; avg: number; attempts: number }[];
  leader: { name: string; photoUrl: string | null } | null;
  members: { id: string; name: string; photoUrl: string | null; position: string | null; isLeader: boolean }[];
};

export type DashboardData = {
  rows: DashboardRow[];
  rowsSorted: DashboardRow[];
  totalAttempts: number;
  overallAvg: number | null;
};

export async function getDashboardData(): Promise<DashboardData> {
  const [departments, processes, documents, exams, scores, users] = await Promise.all([
    prisma.department.findMany({
      // Un área eliminada (borrado lógico, ej. Fulfillment el 2026-10-01) no
      // sale en el organigrama.
      where: { isSpecial: false, deletedAt: null },
      orderBy: { order: "asc" },
      // Someone who's isActive:false left the company — the org chart
      // shouldn't show them as a department's leader anymore.
      include: { leaders: { where: { isActive: true }, select: { name: true, photoUrl: true }, take: 1 } },
    }),
    prisma.process.findMany({ select: { deptId: true } }),
    prisma.document.findMany({ where: { deptId: { not: null } }, select: { deptId: true } }),
    prisma.exam.findMany({ select: { id: true, deptId: true } }),
    prisma.examScore.findMany({ select: { examId: true, userName: true, score: true, total: true } }),
    prisma.user.findMany({
      // Inactive users (left the company) shouldn't appear in the org chart
      // as a team member either — see isActive in the User model.
      where: { deptId: { not: null }, isActive: true },
      select: { id: true, name: true, photoUrl: true, position: true, isLeader: true, deptId: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const examToDept = new Map(exams.map((e) => [e.id, e.deptId]));

  const rows: DashboardRow[] = departments.map((dept) => {
    const procs = processes.filter((p) => p.deptId === dept.id).length;
    const docs = documents.filter((d) => d.deptId === dept.id).length;
    const examCount = exams.filter((e) => e.deptId === dept.id).length;
    const deptScores = scores.filter((s) => examToDept.get(s.examId) === dept.id);

    const avg = deptScores.length
      ? Math.round(deptScores.reduce((a, s) => a + pct(s.score, s.total), 0) / deptScores.length)
      : null;

    const byUser = new Map<string, number[]>();
    for (const s of deptScores) {
      const key = s.userName || "Sin nombre";
      if (!byUser.has(key)) byUser.set(key, []);
      byUser.get(key)!.push(pct(s.score, s.total));
    }
    const ranking = [...byUser.entries()]
      .map(([user, arr]) => ({
        user,
        avg: Math.round(arr.reduce((a, b) => a + b, 0) / arr.length),
        attempts: arr.length,
      }))
      .sort((a, b) => b.avg - a.avg);

    const leader = dept.leaders[0] ? { name: dept.leaders[0].name, photoUrl: dept.leaders[0].photoUrl } : null;

    const members = users
      .filter((u) => u.deptId === dept.id)
      .map((u) => ({ id: u.id, name: u.name, photoUrl: u.photoUrl, position: u.position, isLeader: u.isLeader }))
      .sort((a, b) => (a.isLeader === b.isLeader ? 0 : a.isLeader ? -1 : 1));

    return { dept: { id: dept.id, name: dept.name, code: dept.code }, procs, docs, examCount, attempts: deptScores.length, avg, ranking, leader, members };
  });

  const rowsSorted = [...rows].sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1));
  const totalAttempts = rows.reduce((a, r) => a + r.attempts, 0);
  const ranked = rows.filter((r) => r.avg !== null);
  const overallAvg = ranked.length ? Math.round(ranked.reduce((a, r) => a + (r.avg ?? 0), 0) / ranked.length) : null;

  return { rows, rowsSorted, totalAttempts, overallAvg };
}

export type CommissionProgress = {
  month: string;
  dailyAvg: number | null;
  from: string | null;
  to: string | null;
  tiers: { id: string; name: string; minDailyAvg: number; maxDailyAvg: number | null }[];
} | null;

function currentMonthStr(): string {
  const now = new Date(Date.now() - 5 * 3600 * 1000); // Ecuador UTC-5
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Confirmado 2026-08-14: pedido explícito del usuario — público para TODO
// el equipo (a diferencia de los montos de comisión por persona, que son
// confidenciales), para el efecto motivacional buscado. Mismo cálculo que
// expone /api/commissions/progress, threaded acá igual que weeklyTrend.
//
// Ajuste 2026-08-14: muestra el ÚLTIMO MES COMPLETO (nunca el mes en
// curso) — pedido explícito del usuario para que este número no se vea
// descuadrado contra "Pedidos despachados" (que muestra la última semana
// sola). Un mes completo siempre tiene semanas enteras, así que no hay
// ambigüedad de "hasta qué día" como sí la había con el mes en progreso.
// Coincide además con el mes que de verdad determina el pago real de la
// comisión (se paga en la quincena del mes siguiente).
export async function getCommissionProgress(): Promise<CommissionProgress> {
  const month = prevMonthStr(currentMonthStr());
  const [summary, tiers] = await Promise.all([
    getMonthDispatchSummary(month),
    prisma.commissionTier.findMany({ where: { isActive: true }, orderBy: { orderIndex: "asc" } }),
  ]);
  if (tiers.length === 0) return null;
  return {
    month,
    dailyAvg: summary?.dailyAvg ?? null,
    from: summary?.from ?? null,
    to: summary?.to ?? null,
    tiers: tiers.map((t) => ({ id: t.id, name: t.name, minDailyAvg: t.minDailyAvg, maxDailyAvg: t.maxDailyAvg })),
  };
}

export type WeeklyTrend = {
  deptName: string;
  points: { week: string; value: number; detail?: string; brands?: { label: string; value: number }[] }[];
} | null;

// Shared by both the admin dashboard and every employee's Inicio — whichever
// department has trackWeeklyMetric on (currently just Fulfillment).
//
// Confirmado 2026-07-29 (revertido el mismo día): se probó sumar prepared/
// generated/outOfStock aquí, pero el usuario aclaró que esas tres son solo
// referenciales — representan pedidos que NO se entregaron al courier (des-
// glosados por motivo). Este gráfico es específicamente "despachados", así
// que vuelve a ser solo `value`. El desglose completo vive en
// FillRateBreakdownCard (getLatestFillRateBreakdown), no aquí.
export async function getWeeklyTrend(): Promise<WeeklyTrend> {
  const dept = await prisma.department.findFirst({ where: { trackWeeklyMetric: true } });
  if (!dept) return null;

  const records = await prisma.weeklyMetricRecord.findMany({
    where: { deptId: dept.id },
    orderBy: { week: "asc" },
  });
  if (records.length === 0) return null;

  const brandWeeks = records.map((r) => r.week).filter(isAutoFillRateWeek);
  const [byWeek, externalByWeek] = brandWeeks.length
    ? await Promise.all([guidesByBrandPerWeek(brandWeeks[0]), externalSalesPerWeek(brandWeeks[0])])
    : [new Map<string, Record<string, number>>(), new Map<string, number>()];

  return {
    deptName: dept.name,
    points: records.map((r) => {
      const counts = byWeek.get(r.week);
      let brands = counts ? sortBrands(Object.keys(counts)).map((b) => ({ label: brandLabel(b), value: counts[b] })) : undefined;
      // Desde 2026-10-07 las ventas externas entregadas suman al total (autoFillRate.ts).
      const external = externalByWeek.get(r.week);
      if (external) brands = [...(brands ?? []), { label: "Ventas externas", value: external }];
      return { week: r.week, value: r.value, ...(brands?.length ? { brands } : {}) };
    }),
  };
}

// Ventas externas (no garantías) entregadas al motorizado, por semana ISO
// según el día de Ecuador — mismo criterio que computeAutoCounts.
async function externalSalesPerWeek(fromWeek: string): Promise<Map<string, number>> {
  const sales = await prisma.externalSale.findMany({
    where: { kind: "SALE", deletedAt: null, deliveredAt: { not: null } },
    select: { deliveredAt: true },
  });
  const byWeek = new Map<string, number>();
  for (const s of sales) {
    const week = isoWeekOf(ecuadorDay(s.deliveredAt!));
    if (week >= fromWeek) byWeek.set(week, (byWeek.get(week) ?? 0) + 1);
  }
  return byWeek;
}

// Pedido del usuario (2026-09-30): al pasar el mouse por una semana del
// gráfico de Pedidos despachados, cuántas guías fueron de cada marca. Mismo
// criterio que "Guías por marca" del corte (fulfillmentGuides.ts): la marca
// sale de los productos de la etiqueta; si la guía no los guardó, de la
// marca del PDF entero (cada PDF de Dropi es el manifiesto de UNA marca).
// Solo desde AUTO_FILL_RATE_FROM_WEEK (S40): antes el total lo escribía Yair
// a mano y no hay guías de toda la semana para repartir.
async function guidesByBrandPerWeek(fromWeek: string): Promise<Map<string, Record<string, number>>> {
  const batches = await prisma.fulfillmentRequestBatch.findMany({
    where: { lot: { status: { in: ["SENT", "CLOSED"] } } },
    select: {
      source: true,
      lot: { select: { day: true } },
      guides: { select: { guideNumber: true, codes: true } },
      items: { select: { sourceCode: true, fromComboCode: true, catalogItem: { select: { bodega: true } } } },
    },
  });
  const inRange = batches.filter((b) => b.lot && isoWeekOf(b.lot.day) >= fromWeek);
  const brandOf = await guideBrandsOf(inRange);

  const byWeek = new Map<string, Record<string, number>>();
  for (const b of inRange) {
    const week = isoWeekOf(b.lot!.day);
    const counts = byWeek.get(week) ?? {};
    byWeek.set(week, counts);
    for (const g of b.guides) {
      const brand = brandOf.get(g.guideNumber) ?? NO_BRAND;
      counts[brand] = (counts[brand] ?? 0) + 1;
    }
  }
  return byWeek;
}

// Fill Rate = pedidos despachados / (despachados + no despachados) * 100 — only
// computed for weeks where "no despachados" was actually entered.
export async function getFillRateTrend(): Promise<WeeklyTrend> {
  const dept = await prisma.department.findFirst({ where: { trackWeeklyMetric: true } });
  if (!dept) return null;

  const records = await prisma.weeklyMetricRecord.findMany({
    where: { deptId: dept.id, notDispatched: { not: null } },
    orderBy: { week: "asc" },
  });
  if (records.length === 0) return null;

  const points = records
    .map((r) => {
      const notDispatched = r.notDispatched ?? 0;
      const total = r.value + notDispatched;
      if (total === 0) return null;
      return {
        week: r.week,
        value: Math.round((r.value / total) * 100),
        detail: `${notDispatched.toLocaleString("es-MX")} no despachados`,
      };
    })
    .filter((p): p is { week: string; value: number; detail: string } => p !== null);
  if (points.length === 0) return null;

  return { deptName: dept.name, points };
}

export type FillRateBreakdown = {
  id: string;
  deptId: string;
  deptName: string;
  week: string;
  fillRatePct: number;
  status: "good" | "regular" | "crit";
  total: number;
  dispatched: number;
  prepared: number;
  generated: number;
  outOfStock: number;
  // Confirmado 2026-08-31: si fillRatePct < 95, el líder de Fulfillment le
  // debe una explicación al equipo (visible para todos, no un mensaje
  // privado). needsJustification es ese umbral — es independiente de las
  // bandas de color (que van 90/96), por eso se calcula aparte.
  needsJustification: boolean;
  justification: string | null;
  justificationBy: string | null;
  justificationAt: string | null;
} | null;

// Confirmado 2026-07-28: solo la semana MÁS RECIENTE que ya tenga el
// desglose de las 4 categorías (no un historial) — se ve como una tarjeta
// aparte en Inicio, arriba de Ruptura de Stock, SIN reemplazar la
// tarjetita chiquita de tendencia que ya existe (esa muestra semana a
// semana; esta muestra el detalle de la última). Semanas cargadas antes de
// este cambio no tienen desglose, así que la tarjeta simplemente no
// aparece hasta que exista la primera semana con los 3 campos nuevos.
export async function getLatestFillRateBreakdown(): Promise<FillRateBreakdown> {
  const dept = await prisma.department.findFirst({ where: { trackWeeklyMetric: true } });
  if (!dept) return null;

  const record = await prisma.weeklyMetricRecord.findFirst({
    where: {
      deptId: dept.id,
      OR: [{ prepared: { not: null } }, { generated: { not: null } }, { outOfStock: { not: null } }],
    },
    orderBy: { week: "desc" },
  });
  if (!record) return null;

  const prepared = record.prepared ?? 0;
  const generated = record.generated ?? 0;
  const outOfStock = record.outOfStock ?? 0;
  const total = record.value + prepared + generated + outOfStock;
  if (total === 0) return null;

  const fillRatePct = Math.round((record.value / total) * 100);
  // Confirmado 2026-08-31: bandas reemplazan las anteriores (98/95) — ≥96%
  // excelente, 90-95% muy bueno, <90% alerta/ineficiente.
  const status = fillRatePct >= 96 ? "good" : fillRatePct >= 90 ? "regular" : "crit";

  return {
    id: record.id,
    deptId: dept.id,
    deptName: dept.name,
    week: record.week,
    fillRatePct,
    status,
    total,
    dispatched: record.value,
    prepared,
    generated,
    outOfStock,
    needsJustification: fillRatePct < 95,
    justification: record.fillRateJustification,
    justificationBy: record.fillRateJustificationBy,
    justificationAt: record.fillRateJustificationAt?.toISOString() ?? null,
  };
}

export type UnjustifiedFillRateWeek = { week: string; fillRatePct: number } | null;

// Mismo cálculo de "lunes de esa semana ISO" que ya usa weeklyCheckin.ts/
// pendingTasks.ts (mondayOfIsoWeek, privada en cada uno) — copia local,
// mismo criterio de duplicar date-math pequeño entre archivos que ya
// siguen entre sí.
function mondayOfIsoWeek(week: string): Date {
  const [yearStr, wStr] = week.split("-W");
  const year = Number(yearStr);
  const weekNum = Number(wStr);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));
  const target = new Date(week1Monday);
  target.setUTCDate(week1Monday.getUTCDate() + (weekNum - 1) * 7);
  return target;
}

// Confirmado 2026-09-12: la exigencia de justificación (y el candado que la
// hace obligatoria) recién se creó el 2026-09-08 — antes de esa fecha no
// existía ni el campo ni el aviso, así que no es justo pedirle a Yair que
// explique semanas de meses atrás que nunca supo que necesitaban explicación.
// Cualquier semana anterior a este corte queda exenta para siempre; la regla
// solo aplica hacia adelante desde que se creó.
const FILL_RATE_JUSTIFICATION_RULE_START = new Date(Date.UTC(2026, 8, 8));

// Fuente única del corte de fecha de arriba, para que las rutas de
// weekly-metrics no exijan la explicación "ahora mismo" (needsJustification)
// sobre una semana que ya es de antes de que la regla existiera.
export function fillRateJustificationRuleAppliesTo(week: string): boolean {
  return mondayOfIsoWeek(week) >= FILL_RATE_JUSTIFICATION_RULE_START;
}

// Confirmado 2026-09-08: pedido explícito del usuario — no basta con exigir
// la explicación en el momento en que una semana cae en alerta; si el líder
// de Fulfillment de todos modos se la salta (por ejemplo no entra ese día),
// el hueco no debe poder acumularse en silencio. Mismo principio de bloqueo
// en cascada que ya usa Colaborador del mes
// (getEarliestIncompleteMonthBefore en pendingTasks.ts): no se puede
// avanzar con un registro nuevo mientras quede una semana anterior sin
// resolver. Se usa tanto al crear como al editar — `excludeWeek` deja
// afuera la semana que se está guardando en ese mismo request, para no
// bloquearse a sí misma. Ignora semanas de antes de
// FILL_RATE_JUSTIFICATION_RULE_START (ver comentario ahí).
export async function getOldestUnjustifiedFillRateWeek(deptId: string, excludeWeek?: string): Promise<UnjustifiedFillRateWeek> {
  const records = await prisma.weeklyMetricRecord.findMany({
    where: {
      deptId,
      week: excludeWeek ? { not: excludeWeek } : undefined,
      prepared: { not: null },
      generated: { not: null },
      outOfStock: { not: null },
      fillRateJustification: null,
    },
    orderBy: { week: "asc" },
  });
  for (const r of records) {
    if (mondayOfIsoWeek(r.week) < FILL_RATE_JUSTIFICATION_RULE_START) continue;
    const total = r.value + (r.prepared ?? 0) + (r.generated ?? 0) + (r.outOfStock ?? 0);
    if (total === 0) continue;
    const fillRatePct = Math.round((r.value / total) * 100);
    if (fillRatePct < 95) return { week: r.week, fillRatePct };
  }
  return null;
}

// Tasa de devolución general — un valor mensual (no semanal) que Nairoby o el
// admin cargan a mano. No está atada a un departamento, así que el "deptName"
// del gráfico es solo un rótulo genérico, no un área real.
// Pedido del usuario 2026-09-30: desde octubre 2026 los meses salen solos
// (ver returnRate.ts); lo cargado a mano solo cuenta hasta septiembre.
export async function getReturnRateTrend(): Promise<WeeklyTrend> {
  const [records, autoMonths] = await Promise.all([
    prisma.returnRateRecord.findMany({ orderBy: { month: "asc" } }),
    getAutoReturnRateMonths(),
  ]);
  const points = [
    ...records.filter((r) => !isAutoReturnRateMonth(r.month)).map((r) => ({ week: r.month, value: r.value })),
    // Pedido del usuario 2026-10-01: cada mes automático trae su desglose
    // por marca (la tarjeta de Inicio deja cambiar General ↔ marca).
    ...autoMonths
      .filter((m) => m.pct !== null)
      .reverse()
      .map((m) => {
        const brands = m.byBrand.filter((b) => b.pct !== null).map((b) => ({ label: b.name, value: b.pct! }));
        const parts = [...brands.map((b) => `${b.label} ${b.value}%`), ...(m.closed ? [] : ["preliminar"])];
        return { week: m.month, value: m.pct!, brands, detail: parts.join(" · ") || undefined };
      }),
  ];
  if (points.length === 0) return null;

  return { deptName: "General", points };
}

export type StockoutWeekPoint = { week: string; value: number; products: string[] };

export type StockoutWeekDetail = {
  week: string;
  // true = armada sola con los cortes (desde 2026-W40); false = cargada a mano.
  auto: boolean;
  products: { name: string; justCode: string | null; needed?: number; out?: number }[];
};

// Ruptura de Stock semana por semana. Hasta la semana 39 son los productos
// que Daniel marcó a mano; desde la 40 se arma sola con los cortes (ver
// autoStockout.ts) y lo manual de esas semanas se ignora.
export async function getStockoutWeekDetails(): Promise<StockoutWeekDetail[]> {
  const [rows, confirmations, autoWeeks] = await Promise.all([
    prisma.stockoutWeekProduct.findMany({
      select: { week: true, product: { select: { name: true, catalogItem: { select: { justCode: true } } } } },
    }),
    prisma.stockoutWeekConfirmation.findMany({ select: { week: true } }),
    computeAutoStockoutWeeks(),
  ]);

  const byWeek = new Map<string, StockoutWeekDetail>();
  // Semanas confirmadas "sin productos agotados" entran con 0.
  for (const c of confirmations) {
    if (!isAutoStockoutWeek(c.week)) byWeek.set(c.week, { week: c.week, auto: false, products: [] });
  }
  for (const r of rows) {
    if (isAutoStockoutWeek(r.week)) continue;
    if (!byWeek.has(r.week)) byWeek.set(r.week, { week: r.week, auto: false, products: [] });
    byWeek.get(r.week)!.products.push({ name: r.product.name, justCode: r.product.catalogItem?.justCode ?? null });
  }
  for (const [week, products] of autoWeeks) {
    byWeek.set(week, { week, auto: true, products: products.map(({ name, justCode, needed, out }) => ({ name, justCode, needed, out })) });
  }

  return [...byWeek.values()]
    .sort((a, b) => a.week.localeCompare(b.week))
    .map((w) => ({ ...w, products: [...w.products].sort((a, b) => a.name.localeCompare(b.name)) }));
}

// La barra de cada semana es la CANTIDAD de productos distintos con
// ruptura, no una cantidad de unidades ni de veces.
export async function getStockoutWeeks(): Promise<StockoutWeekPoint[]> {
  const weeks = await getStockoutWeekDetails();
  return weeks.map((w) => ({ week: w.week, value: w.products.length, products: w.products.map((p) => p.name) }));
}

// trend compares this category's share of the total (not its raw count) in
// the most recently loaded month against the month before it — a rising
// share means that reason is becoming relatively more common, not just that
// overall volume grew. Left undefined until at least two months of data exist.
export type PieSlice = { label: string; value: number; trend?: "up" | "down"; group?: WarrantyReasonGroup };
// rate/prevRatePct: garantías ÷ pedidos del mes en % sin decimales (pedido
// del usuario 2026-10-03) — solo meses automáticos (desde octubre 2026).
export type WarrantyMonthlyChart = { month: string; total: number; slices: PieSlice[]; rate?: { orders: number; ratePct: number } | null; prevRatePct?: number | null };

// Pedido del usuario 2026-10-03: las garantías locales (GL) no suman al total
// pero sus motivos sí se suman a los gráficos de motivos. Devuelve las mismas
// filas de conteo con las de las locales agregadas.
async function withLocalWarrantyCounts<T extends { month: string; count: number; category: { name: string } }>(counts: T[], months: string[]): Promise<{ month: string; count: number; category: { name: string } }[]> {
  const local = await getLocalWarrantyReasonCounts(months);
  const out: { month: string; count: number; category: { name: string } }[] = counts.map((c) => ({ month: c.month, count: c.count, category: { name: c.category.name } }));
  for (const [month, byName] of local) for (const [name, count] of byName) out.push({ month, count, category: { name } });
  return out;
}

// Falla del producto primero, luego error de bodega, luego otros; dentro de
// cada grupo de mayor a menor — el mismo orden da los mismos colores en la
// torta y en la tendencia.
function groupedOrder(slices: PieSlice[]): PieSlice[] {
  const rank: Record<WarrantyReasonGroup, number> = { PRODUCTO: 0, BODEGA: 1, OTRO: 2 };
  return slices
    .map((sl) => ({ ...sl, group: warrantyReasonGroup(sl.label) }))
    .sort((a, b) => rank[a.group] - rank[b.group] || b.value - a.value);
}

// Gráfico 1 de KPI de Garantías — la torta del mes más reciente cargado por
// Nairoby: cuántas garantías de cada categoría, sobre el total ingresado ese mes.
export async function getWarrantyMonthlyChart(): Promise<WarrantyMonthlyChart | null> {
  const latest = await prisma.warrantyMonthTotal.findFirst({ orderBy: { month: "desc" } });
  if (!latest) return null;

  const counts = await withLocalWarrantyCounts(
    await prisma.warrantyCategoryMonthCount.findMany({
      where: { month: latest.month },
      include: { category: { select: { name: true } } },
    }),
    [latest.month]
  );
  const byName = new Map<string, number>();
  for (const c of counts) byName.set(c.category.name, (byName.get(c.category.name) ?? 0) + c.count);

  const prevMonth = previousMonth(latest.month);
  const [rate, prevTotal] = await Promise.all([
    getWarrantyRate(latest.month, latest.total),
    prisma.warrantyMonthTotal.findUnique({ where: { month: prevMonth }, select: { total: true } }),
  ]);
  const prevRate = prevTotal ? await getWarrantyRate(prevMonth, prevTotal.total) : null;

  return {
    month: latest.month,
    total: latest.total,
    slices: groupedOrder([...byName.entries()].map(([label, value]) => ({ label, value }))),
    rate,
    prevRatePct: prevRate?.ratePct ?? null,
  };
}

function last12Months(): string[] {
  const now = new Date();
  const months: string[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return months;
}

// Gráfico 2 de KPI de Garantías — no se sube por separado. Suma las mismas
// categorías del Gráfico 1 a lo largo de los últimos 12 meses (aprobadas y
// rechazadas cuentan por igual) para ver cuál motivo se repite más.
export async function getWarrantyReasonChart(): Promise<PieSlice[]> {
  const months = last12Months();

  const counts = await withLocalWarrantyCounts(
    await prisma.warrantyCategoryMonthCount.findMany({
      where: { month: { in: months } },
      include: { category: { select: { name: true } } },
    }),
    months
  );
  if (counts.length === 0) return [];

  const byCategory = new Map<string, number>();
  for (const c of counts) {
    byCategory.set(c.category.name, (byCategory.get(c.category.name) ?? 0) + c.count);
  }

  // Trend compares the most recent month that actually has data against the
  // month right before it — not a fixed recent-6-vs-prior-6 calendar split.
  // Categories get entered roughly one month at a time, so a calendar split
  // would sit with no trend at all for the first six real months; comparing
  // the two latest loaded months instead means it lights up as soon as a
  // second month exists.
  const distinctMonths = [...new Set(counts.map((c) => c.month))].sort((a, b) => b.localeCompare(a));
  const [latestMonth, prevMonth] = distinctMonths;

  const latestByCategory = new Map<string, number>();
  const prevByCategory = new Map<string, number>();
  let latestTotal = 0;
  let prevTotal = 0;
  if (latestMonth && prevMonth) {
    for (const c of counts) {
      if (c.month === latestMonth) {
        latestByCategory.set(c.category.name, (latestByCategory.get(c.category.name) ?? 0) + c.count);
        latestTotal += c.count;
      } else if (c.month === prevMonth) {
        prevByCategory.set(c.category.name, (prevByCategory.get(c.category.name) ?? 0) + c.count);
        prevTotal += c.count;
      }
    }
  }

  return groupedOrder([...byCategory.entries()]
    .map(([label, value]) => {
      let trend: "up" | "down" | undefined;
      if (latestTotal > 0 && prevTotal > 0) {
        const latestShare = (latestByCategory.get(label) ?? 0) / latestTotal;
        const prevShare = (prevByCategory.get(label) ?? 0) / prevTotal;
        if (latestShare > prevShare) trend = "up";
        else if (latestShare < prevShare) trend = "down";
      }
      return { label, value, trend };
    }));
}

export type WarrantyReasonTrendSeries = {
  label: string;
  points: { month: string; value: number; count: number }[];
};

// Pedido de Daniel 2026-09-09: no solo saber CUÁL motivo se repite más (eso
// ya lo dice getWarrantyReasonChart arriba), sino cómo se ha movido cada uno
// MES A MES — una línea por motivo. `value` es el % que representó ese
// motivo del total de garantías de ese mes (no el conteo crudo), mismo
// criterio de "share" que ya usa el trend up/down de arriba, para que un mes
// con más volumen general no se vea como que todos los motivos "subieron".
// `count` se agrega igual (pedido explícito de Daniel el mismo día) para
// mostrar la cantidad real junto al %, ya que el % solo no dice si "42%" son
// 8 casos o 80.
export async function getWarrantyReasonMonthlyTrend(): Promise<WarrantyReasonTrendSeries[]> {
  const months = last12Months();

  const counts = await withLocalWarrantyCounts(
    await prisma.warrantyCategoryMonthCount.findMany({
      where: { month: { in: months } },
      include: { category: { select: { name: true } } },
    }),
    months
  );
  if (counts.length === 0) return [];

  const distinctMonths = [...new Set(counts.map((c) => c.month))].sort();
  if (distinctMonths.length < 2) return [];

  const totalByMonth = new Map<string, number>();
  for (const c of counts) totalByMonth.set(c.month, (totalByMonth.get(c.month) ?? 0) + c.count);

  const countByLabelMonth = new Map<string, Map<string, number>>();
  for (const c of counts) {
    if (!countByLabelMonth.has(c.category.name)) countByLabelMonth.set(c.category.name, new Map());
    countByLabelMonth.get(c.category.name)!.set(c.month, c.count);
  }

  return [...countByLabelMonth.entries()].map(([label, byMonth]) => ({
    label,
    points: distinctMonths.map((month) => {
      const monthTotal = totalByMonth.get(month) ?? 0;
      const count = byMonth.get(month) ?? 0;
      return { month, value: monthTotal > 0 ? Math.round((count / monthTotal) * 1000) / 10 : 0, count };
    }),
  }));
}
