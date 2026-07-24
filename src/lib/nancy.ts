import Anthropic from "@anthropic-ai/sdk";
import { computeDerived, consolidateMonth, type FinanceMonthRaw } from "@/lib/financeKpisCalc";
import type { FinanceKpiDataDTO } from "@/lib/financeKpis";

let client: Anthropic | null = null;

// Lazily constructed so a missing ANTHROPIC_API_KEY only throws when Nancy is
// actually invoked, not at module load (which would break every route that
// imports financeKpis.ts transitively before the key is configured).
export function getAnthropicClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

export const NANCY_SYSTEM_PROMPT = `Eres Nancy, la asistente de análisis financiero y contable de DAFLOW para Provedix (Guayaquil, Ecuador).

Tu único propósito es ayudar a interpretar y validar los KPIs financieros y contables ya cargados en este panel — ventas, costos, gastos, márgenes, ROI, y los saldos de inventario/cartera/proveedores. Trabajas exclusivamente con los datos que se te entregan en cada mensaje bajo "DATOS ACTUALES" — nunca inventes cifras ni asumas información que no esté ahí. Si te falta un dato para responder, dilo explícitamente en vez de adivinar.

Qué SÍ haces:
- Explicas qué significa cada indicador y cómo se calculó (por ejemplo, de dónde sale el margen neto, o por qué el ROI subió o bajó un mes).
- Detectas patrones, anomalías o meses atípicos dentro de los datos entregados.
- Ayudas a la persona a aprender a leer y validar la información por sí misma — no le des solo la respuesta, guíala a entender de dónde sale.
- Respondes siempre en español, con un tono claro, directo y educativo, sin tecnicismos innecesarios.

Qué NO haces:
- No das asesoría legal, fiscal formal, ni recomendaciones de inversión o financiamiento — la empresa ya tiene un asesor personal para eso. Si te preguntan algo de esa naturaleza, dilo con claridad y sugiere consultarlo con su contadora o asesor.
- No opinas sobre temas fuera de los KPIs financieros/contables de este panel.
- No inventas cifras que no estén en el contexto entregado.

Cierra con un recordatorio breve de que esto es apoyo informativo y no reemplaza la revisión de la contadora ni del asesor legal/financiero, solo cuando sea relevante para la pregunta — no lo repitas en cada respuesta si ya quedó claro en la conversación.`;

// Mirrors FinanceDashboard's own "series" derivation for a given brand, so
// Nancy always reasons over the same numbers the user is looking at — built
// server-side from the real DB data (not trusting client-supplied figures),
// with only the brand selector taken from the client to describe scope.
export function buildNancyContext(data: FinanceKpiDataDTO, filters: { brand: string }): string {
  const activeOps = data.operations.filter((o) => o.isActive);
  let raw: FinanceMonthRaw[];
  let scopeLabel: string;

  const matchedOp = data.operations.find((o) => o.id === filters.brand);
  if (!matchedOp || filters.brand === "consolidado") {
    const periodsSet = new Set<string>();
    for (const op of activeOps) for (const r of data.recordsByOperation[op.id] ?? []) periodsSet.add(r.period);
    const periods = [...periodsSet].sort();
    raw = periods.map((period) => {
      const rows = activeOps
        .map((op) => (data.recordsByOperation[op.id] ?? []).find((r) => r.period === period))
        .filter((r): r is FinanceMonthRaw => !!r);
      return consolidateMonth(rows);
    });
    scopeLabel = "Consolidado (todas las operaciones activas)";
  } else {
    raw = (data.recordsByOperation[filters.brand] ?? []).slice().sort((a, b) => a.period.localeCompare(b.period));
    scopeLabel = matchedOp.name;
  }

  const windowed = raw.slice(-12).map(computeDerived);
  if (windowed.length === 0) {
    return `DATOS ACTUALES\nOperación: ${scopeLabel}\nNo hay meses cargados todavía para esta operación.`;
  }

  const rows = windowed
    .map((m) => {
      const roiText = m.roi !== null ? `${m.roi.toFixed(1)}%` : "sin dato";
      return (
        `${m.period}: ventas $${Math.round(m.ventas)}, costo de ventas $${Math.round(m.costoVentas)}, ` +
        `gastos operativos $${Math.round(m.gastosOperativos)} (venta $${Math.round(m.gastosVenta)} + admin $${Math.round(m.gastosAdmin)}), ` +
        `otros ingresos $${Math.round(m.otrosIngresos)}, gastos financieros $${Math.round(m.gastosFinancieros)}, otros gastos $${Math.round(m.otrosGastos)} ` +
        `→ utilidad bruta $${Math.round(m.utilidadBruta)} (margen bruto ${m.margenBruto.toFixed(1)}%), ` +
        `utilidad operativa $${Math.round(m.utilidadOperativa)} (margen operativo ${m.margenOperativo.toFixed(1)}%), ` +
        `utilidad neta $${Math.round(m.utilidadReportada)} (margen neto ${m.margenNeto.toFixed(1)}%), ROI ${roiText}`
      );
    })
    .join("\n");

  const s = data.settings;
  const settingsText =
    `Metas configuradas: margen bruto objetivo ${s.targetMargenBruto}%, margen operativo objetivo ${s.targetMargenOperativo}%, ` +
    `margen neto objetivo ${s.targetMargenNeto}% (excelente desde ${s.excelenteMargenNeto}%), tasa de impuesto ${s.taxRatePct}%. ` +
    `Bandas de ROI: rojo <${s.roiBandRed}%, regular ${s.roiBandRed}-${s.roiBandYellow}%, saludable ${s.roiBandYellow}-${s.roiBandExcellent}%, excelente ≥${s.roiBandExcellent}%.`;

  const lastBalance = data.sharedBalances[data.sharedBalances.length - 1];
  const balanceText = lastBalance
    ? `Saldos compartidos más recientes (${lastBalance.period}, no divididos por operación): inventario final ${
        lastBalance.inventarioFinal ?? "sin dato"
      }, cuentas por cobrar ${lastBalance.cuentasPorCobrar ?? "sin dato"}, cuentas por pagar ${lastBalance.cuentasPorPagar ?? "sin dato"}.`
    : "Sin saldos de inventario/cartera/proveedores cargados todavía.";

  return `DATOS ACTUALES\nOperación seleccionada: ${scopeLabel}\nÚltimos ${windowed.length} meses cargados:\n${rows}\n\n${settingsText}\n${balanceText}`;
}
