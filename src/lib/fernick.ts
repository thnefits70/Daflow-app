import { prisma } from "@/lib/prisma";
import { getFinanceKpiData, type FinanceKpiDataDTO } from "@/lib/financeKpis";
import { computeDerived, consolidateMonth, type FinanceMonthRaw } from "@/lib/financeKpisCalc";
import { getFinanzasDeptId } from "@/lib/inventoryKpis";
import {
  getWeeklyTrend,
  getFillRateTrend,
  getReturnRateTrend,
  getStockoutWeeks,
  getWarrantyMonthlyChart,
  getWarrantyReasonChart,
} from "@/lib/dashboard";

// FERNICK es exclusivo de admin (confirmado 2026-08-24) — sin deptId porque
// razona sobre toda la empresa, no un área puntual. ownerId se mantiene por
// el mismo patrón sin FK que nancyOwnerId, por si el acceso se amplía más
// adelante; hoy siempre resuelve a "admin".
export function fernickOwnerId(): string {
  return "admin";
}

export const FERNICK_SYSTEM_PROMPT = `Eres FERNICK, el asistente empresarial estratégico de DAFLOW para Provedix (Guayaquil, Ecuador), un negocio B2B.

Piensas como un empresario que ya escaló varios negocios B2B de $100,000/mes a $1,000,000/mes de facturación. Tu misión con Andrés (el dueño, quien te habla directamente) es exactamente esa: ayudarlo a escalar Provedix de su nivel actual hacia $1,000,000/mes de facturación mensual, un paso a la vez.

CÓMO LE HABLAS A ANDRÉS — esto es tan importante como los datos:
Andrés no quiere un informe corporativo, quiere hablar con alguien de confianza que lo está ayudando a escalar. Háblale como le hablarías a un amigo cercano al que además respetas como socio de negocios — cercano, directo, cálido, con la confianza de decirle las cosas claras (incluso cuando algo no pinta bien) sin sonar frío ni acartonado. Nada de lenguaje de consultora ("se recomienda", "cabe destacar", "en conclusión"): habla como hablarías vos, en primera persona, como si estuvieras sentado con él viendo los números juntos.
- No estructures cada respuesta igual (encabezados + viñetas en cascada todo el tiempo cansa y suena a reporte). A veces la respuesta correcta es un párrafo hablado, directo; usa listas solo cuando de verdad ayudan a que algo se entienda mejor, no como formato por defecto.
- Puedes reaccionar como reaccionaría un amigo — con entusiasmo genuino cuando algo va bien, con preocupación honesta cuando algo no, con humor si viene al caso — sin perder el hilo de que sos su asesor de crecimiento, no un porrista vacío.
- Recibirás, junto con los datos de la empresa, una muestra de mensajes reales que Andrés te ha escrito antes. Léela para captar cómo habla él — su registro, qué tan formal o informal es, sus expresiones — y ajusta tu propio tono para que la conversación se sienta natural entre ustedes dos, cada vez más así con el tiempo. No la copies literal ni comentes que la estás usando, simplemente charla como si ya lo conocieras.
- Esto NUNCA es excusa para relajar los números: la precisión de los datos es sagrada, el tono cálido es solo la forma de entregarlos. Un dato mal dicho con cariño sigue siendo un dato mal dicho.

Trabajas exclusivamente con los datos reales que se te entregan en cada mensaje bajo "DATOS ACTUALES DE LA EMPRESA" — nunca inventes cifras ni asumas información que no esté ahí. Si te falta un dato clave para responder algo con solidez, dilo explícitamente y pide que se cargue esa información en el módulo correspondiente de DAFLOW, en vez de adivinar.

Cómo piensas:
- Conectas siempre el dato con la palanca de crecimiento que mueve: ventas/adquisición, margen, retención (devoluciones/garantías), eficiencia operativa (fulfillment, inventario) o estructura de costos (compras). Un negocio B2B escala por una combinación de esas palancas, no por una sola métrica aislada.
- Cuando detectas algo relevante en los datos (una tendencia, un cuello de botella, un margen que se comprime, un gasto que crece más rápido que las ventas), lo señalas tú mismo dentro de la respuesta, no esperas a que te pregunten exactamente por eso.
- Das recomendaciones concretas y accionables, priorizadas por impacto y esfuerzo — nunca genéricas tipo "mejora tu marketing". Si sugieres una acción, explica por qué esos datos la sugieren y qué deberías ver moverse si funciona.
- Piensas en camino de escalamiento por etapas (de $100K a $200K no se resuelve igual que de $500K a $1M) — ubica en qué etapa aproximada está el negocio según los datos entregados y adapta el consejo a esa etapa, no a la meta final directamente.
- Eres honesto cuando los datos son insuficientes o contradictorios — un buen asesor no fuerza una conclusión que los números no sostienen.
- Respondes siempre en español.

Qué NO haces:
- No das asesoría legal, fiscal formal, ni contable detallada — eso ya lo cubre Nancy (la asistente financiera/contable de este mismo panel) y el asesor externo de la empresa. Si la pregunta es puramente contable/fiscal, dilo y sugiere usar Nancy o consultar con la contadora.
- No inventas cifras, porcentajes ni proyecciones que no se puedan derivar razonablemente de los datos entregados.
- No dependes de un solo mensaje para "resolver" el crecimiento — construyes sobre la conversación, recordando lo ya discutido en este hilo.`;

function fmtMoney(n: number): string {
  return `$${Math.round(n).toLocaleString("es-EC")}`;
}

function fmtPct(n: number | null): string {
  return n === null ? "sin dato" : `${n.toFixed(1)}%`;
}

// Ingresos y márgenes consolidados (todas las operaciones/marcas activas —
// Provedix e Importadora Damián) de los últimos 12 meses, igual base que usa
// Nancy, para que FERNICK razone sobre la facturación real, no una marca sola.
function buildFinanceSection(data: FinanceKpiDataDTO): string {
  const activeOps = data.operations.filter((o) => o.isActive);
  const periodsSet = new Set<string>();
  for (const op of activeOps) for (const r of data.recordsByOperation[op.id] ?? []) periodsSet.add(r.period);
  const periods = [...periodsSet].sort();

  if (periods.length === 0) {
    return "FACTURACIÓN Y MÁRGENES (consolidado)\nTodavía no hay meses de KPIs financieros cargados.";
  }

  const raw: FinanceMonthRaw[] = periods.map((period) => {
    const rows = activeOps
      .map((op) => (data.recordsByOperation[op.id] ?? []).find((r) => r.period === period))
      .filter((r): r is FinanceMonthRaw => !!r);
    return consolidateMonth(rows);
  });
  const windowed = raw.slice(-12).map(computeDerived);

  const rows = windowed
    .map(
      (m) =>
        `${m.period}: facturación ${fmtMoney(m.ventas)}, margen bruto ${fmtPct(m.margenBruto)}, margen operativo ${fmtPct(
          m.margenOperativo
        )}, margen neto ${fmtPct(m.margenNeto)}, ROI ${m.roi !== null ? fmtPct(m.roi) : "sin dato"}`
    )
    .join("\n");

  const first = windowed[0];
  const last = windowed[windowed.length - 1];
  const growthNote =
    windowed.length >= 2 && first.ventas > 0
      ? `Crecimiento de facturación entre ${first.period} y ${last.period}: ${(((last.ventas - first.ventas) / first.ventas) * 100).toFixed(1)}%.`
      : "";
  const targetNote = `Meta declarada por Andrés: escalar de facturación actual (~${fmtMoney(last.ventas)}/mes) a $1,000,000/mes.`;

  return `FACTURACIÓN Y MÁRGENES (consolidado, todas las marcas activas — últimos ${windowed.length} meses)\n${rows}\n${growthNote}\n${targetNote}`;
}

function buildInventorySection(data: FinanceKpiDataDTO): string {
  const inv = data.inventoryKpis;
  if (!inv.hasData) return "INVENTARIO\nSin datos de inventario cargados todavía.";

  const dioText =
    inv.dio.current !== null
      ? `DIO (días de inventario) actual: ${inv.dio.current.toFixed(0)} días${
          inv.dio.previous !== null ? ` (mes anterior: ${inv.dio.previous.toFixed(0)})` : ""
        }`
      : "DIO sin dato";
  const gmroiText =
    inv.gmroiSeries.current !== null
      ? `GMROI actual: ${inv.gmroiSeries.current.toFixed(2)}${
          inv.gmroiSeries.previous !== null ? ` (mes anterior: ${inv.gmroiSeries.previous.toFixed(2)})` : ""
        }`
      : "GMROI sin dato";
  const overstockText = inv.overstockAlert.alert
    ? `Alerta de sobrestock activa: ${inv.overstockAlert.message}`
    : "Sin alerta de sobrestock activa.";
  const staleText =
    inv.staleSummary.totalStaleValue > 0
      ? `Inventario sin movimiento: ${fmtMoney(inv.staleSummary.totalStaleValue)}${
          inv.staleSummary.totalStalePct !== null ? ` (${inv.staleSummary.totalStalePct.toFixed(1)}% del inventario del período)` : ""
        } — ${inv.staleSummary.bucket4plus.length} producto(s) con 4+ meses sin rotar.`
      : "Sin inventario estancado detectado.";

  return `INVENTARIO\n${dioText}\n${gmroiText}\n${overstockText}\n${staleText}`;
}

function trendSummary(points: { week: string; value: number }[] | undefined, unit: string, lastN = 6): string {
  if (!points || points.length === 0) return "sin datos";
  const recent = points.slice(-lastN);
  const last = recent[recent.length - 1];
  const first = recent[0];
  const dir = recent.length >= 2 ? (last.value > first.value ? "↑ subiendo" : last.value < first.value ? "↓ bajando" : "estable") : "";
  return `último valor ${last.value}${unit} (${last.week})${dir ? `, tendencia reciente ${dir}` : ""} — últimos ${recent.length}: ${recent
    .map((p) => `${p.week}:${p.value}`)
    .join(", ")}`;
}

// Operación (fulfillment/calidad) — mismos datos que ya se ven en Inicio/KPIs
// Generales, resumidos en texto para que FERNICK conecte crecimiento de
// ventas con si la operación puede sostenerlo.
async function buildOperationsSection(): Promise<string> {
  const [weekly, fillRate, returnRate, stockoutWeeks, warrantyMonthly, warrantyReasons] = await Promise.all([
    getWeeklyTrend(),
    getFillRateTrend(),
    getReturnRateTrend(),
    getStockoutWeeks(),
    getWarrantyMonthlyChart(),
    getWarrantyReasonChart(),
  ]);

  const lines: string[] = [];
  lines.push(`Pedidos despachados (semanal): ${trendSummary(weekly?.points, "")}`);
  lines.push(`Fill Rate (semanal): ${trendSummary(fillRate?.points, "%")}`);
  lines.push(`Tasa de Devolución (mensual, menor es mejor): ${trendSummary(returnRate?.points, "%")}`);

  if (stockoutWeeks.length > 0) {
    const recent = stockoutWeeks.slice(-4);
    lines.push(
      `Ruptura de Stock (semanal, N° de productos distintos agotados): ${recent
        .map((w) => `${w.week}:${w.value}`)
        .join(", ")}`
    );
  } else {
    lines.push("Ruptura de Stock: sin semanas registradas.");
  }

  if (warrantyMonthly) {
    const topSlices = [...warrantyMonthly.slices].sort((a, b) => b.value - a.value).slice(0, 3);
    lines.push(
      `Garantías del mes (${warrantyMonthly.month}): ${warrantyMonthly.total} ingresadas — motivos principales: ${topSlices
        .map((s) => `${s.label} (${s.value})`)
        .join(", ")}`
    );
  } else {
    lines.push("Garantías: sin mes cargado todavía.");
  }

  if (warrantyReasons.length > 0) {
    const topReasons = [...warrantyReasons].sort((a, b) => b.value - a.value).slice(0, 3);
    lines.push(
      `Motivos de garantía más recurrentes (últimos 12 meses): ${topReasons
        .map((s) => `${s.label} (${s.value}${s.trend ? `, ${s.trend === "up" ? "subiendo" : "bajando"}` : ""})`)
        .join(", ")}`
    );
  }

  return `OPERACIÓN Y CALIDAD\n${lines.join("\n")}`;
}

// Gasto real en compras (Control de Compras) — pagado por mes, últimos 6
// meses con pago registrado, más cuántas solicitudes están hoy pendientes de
// aprobación. Da contexto de estructura de costos frente a la facturación.
async function buildPurchasingSection(): Promise<string> {
  const [paidRows, pendingCount] = await Promise.all([
    prisma.purchaseRequest.findMany({
      where: { status: "PAID", paidAt: { not: null } },
      select: { paidAt: true, totalCost: true },
      orderBy: { paidAt: "desc" },
      take: 500,
    }),
    prisma.purchaseRequest.count({ where: { status: "PENDING_APPROVAL" } }),
  ]);

  if (paidRows.length === 0) {
    return `CONTROL DE COMPRAS\nSin compras pagadas registradas todavía. Solicitudes pendientes de aprobación ahora mismo: ${pendingCount}.`;
  }

  const byMonth = new Map<string, { total: number; count: number }>();
  for (const r of paidRows) {
    if (!r.paidAt) continue;
    const key = `${r.paidAt.getUTCFullYear()}-${String(r.paidAt.getUTCMonth() + 1).padStart(2, "0")}`;
    const entry = byMonth.get(key) ?? { total: 0, count: 0 };
    entry.total += r.totalCost;
    entry.count += 1;
    byMonth.set(key, entry);
  }

  const months = [...byMonth.keys()].sort().slice(-6);
  const rows = months.map((m) => {
    const e = byMonth.get(m)!;
    return `${m}: ${fmtMoney(e.total)} en ${e.count} compra(s)`;
  });

  return `CONTROL DE COMPRAS (gasto pagado por mes)\n${rows.join("\n")}\nSolicitudes pendientes de aprobación ahora mismo: ${pendingCount}.`;
}

// "Aprende cómo habla Andrés" sin infraestructura nueva: toma sus últimos
// mensajes reales (de CUALQUIER conversación pasada con FERNICK, no solo la
// actual — ya quedan guardados en FernickMessage) y se los pasa al modelo
// como muestra de su registro/tono, para que FERNICK lo imite cada vez mejor
// a medida que se acumulan más conversaciones. Confirmado 2026-08-24: pedido
// explícito de Andrés — que la charla se sienta como entre amigos, no rígida.
async function getRecentUserStyleSample(ownerId: string, excludeConversationId?: string): Promise<string> {
  const rows = await prisma.fernickMessage.findMany({
    where: {
      role: "user",
      conversation: { ownerId, ...(excludeConversationId ? { id: { not: excludeConversationId } } : {}) },
    },
    orderBy: { createdAt: "desc" },
    take: 15,
    select: { content: true },
  });
  if (rows.length === 0) return "";

  const sample = rows
    .reverse()
    .map((r) => `- "${r.content.replace(/\s+/g, " ").trim().slice(0, 240)}"`)
    .join("\n");

  return `CÓMO SUELE ESCRIBIRTE ANDRÉS (mensajes reales suyos de conversaciones anteriores, más recientes al final — usa esto solo para calibrar tu tono, nunca lo cites ni lo menciones)\n${sample}`;
}

// Arma el contexto completo que FERNICK recibe en cada mensaje — construido
// server-side a partir de datos reales de todos los módulos con números
// (finanzas, inventario, operación/calidad, compras), nunca confiado del
// cliente. Cada sección se degrada a un texto "sin datos" si ese módulo
// todavía no tiene información, en vez de fallar.
export async function buildFernickContext(ownerId: string, currentConversationId?: string): Promise<string> {
  const financeDeptId = await getFinanzasDeptId();
  const financeData = financeDeptId ? await getFinanceKpiData(financeDeptId) : null;

  const [operationsSection, purchasingSection, styleSample] = await Promise.all([
    buildOperationsSection(),
    buildPurchasingSection(),
    getRecentUserStyleSample(ownerId, currentConversationId),
  ]);

  const financeSection = financeData ? buildFinanceSection(financeData) : "FACTURACIÓN Y MÁRGENES\nSin datos financieros cargados todavía.";
  const inventorySection = financeData ? buildInventorySection(financeData) : "INVENTARIO\nSin datos cargados todavía.";

  const styleBlock = styleSample ? `\n\n${styleSample}` : "";

  return `DATOS ACTUALES DE LA EMPRESA\n\n${financeSection}\n\n${inventorySection}\n\n${operationsSection}\n\n${purchasingSection}${styleBlock}`;
}
