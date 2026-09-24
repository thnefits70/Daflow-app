import { prisma } from "@/lib/prisma";
import { SUPPLIER_PUBLIC_LINK_START, isReportBlockingDebtPayment } from "@/lib/supplierDebt";

// Confirmado 2026-09-24, pedido explícito del usuario: pestañas "Pedidos
// <mes> <año>" de la hoja de CHEN — una por mes, desde septiembre 2026 (a
// partir del 21-sep, SUPPLIER_PUBLIC_LINK_START). Al empezar un mes nuevo
// aparece sola, con las mismas columnas y el mismo orden. El mes se cuenta en
// hora de Guayaquil (UTC-5).
//
// Todo lo automático sale de lo que ya existe en DAFLOW y se arma en cada
// carga (siempre al día), nunca se guarda como celda:
//   Arriba — un pedido por fila (solo aprobados por Bryan):
//     Imagen · Producto · Unidades pedidas · Precio (el acordado en la
//     solicitud de Jariel) · Fecha del pedido · Estado (bien / dañadas /
//     faltantes / por reponer / repuestas / de más / en camino) · Llegó a
//     bodega (cuando los chicos la recibieron y revisaron, NO la aprobación
//     de Daniel) · ¿Completo? · Unidades buenas · Total (buenas × precio,
//     incluye las de más) · Pago (Pagado — Pago N / en proceso / Pendiente).
//   Abajo — los pagos (tandas) de esos pedidos: una fila por comprobante con
//     número, fecha, monto y la foto; y el total de CADA pago. Nunca la suma de
//     lo pendiente (ver memoria: el enlace de CHEN nunca muestra deuda total).
// CHEN nunca devuelve dinero ni da descuento: lo dañado o faltante lo repone
// con mercadería, así que no hay columna de descuento.
//
// Las columnas AUTO_ORDERS_COLS no las cambia nadie (la API lo rechaza). Lo
// que CHEN escribe en las columnas de la derecha queda amarrado al PEDIDO o
// pago de esa fila (rowKey), nunca al número de fila — ver
// SupplierSheetAnchoredCell.

export const AUTO_ORDERS_COLS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
// Compacto (pedido explícito del usuario 2026-09-24): miniaturas; doble clic
// sobre la foto la amplía.
const IMAGE_ROW_H = 46;
const PROOF_ROW_H = 60;
const GYE_OFFSET_HOURS = 5; // Guayaquil = UTC-5, sin horario de verano
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const FIRST_MONTH = { y: 2026, m: 8 };

const COL_WIDTHS: Record<string, number> = {
  "0": 58, "1": 190, "2": 62, "3": 64, "4": 82, "5": 190, "6": 82, "7": 86, "8": 60, "9": 80, "10": 140,
  // Primeras columnas libres para las notas de CHEN.
  "11": 220, "12": 180, "13": 180,
};

// Colores (fondo, letra) — verde bien, ámbar pendiente/problema, gris en espera.
const GREEN = { bg: "#e6f4ea", fc: "#137333" };
const AMBER = { bg: "#fef7e0", fc: "#b06000" };
const GRAY = { bg: "#f1f3f4", fc: "#5f6368" };
const HEADER = { b: true, al: "center" as const, bg: "#e8eaed", wr: true };

type YearMonth = { y: number; m: number }; // m: 0 = enero

function ymKey({ y, m }: YearMonth) {
  return `${y}-${String(m + 1).padStart(2, "0")}`;
}

// Septiembre 2026 conserva el id de la pestaña "Pedidos" original.
export function autoOrdersTabId(supplierId: string, ym: YearMonth) {
  const key = ymKey(ym);
  return key === ymKey(FIRST_MONTH) ? `auto-pedidos-${supplierId}` : `auto-pedidos-${supplierId}-${key}`;
}

export function isAutoOrdersTabId(id: string) {
  return id.startsWith("auto-pedidos-");
}

function monthOfTabId(id: string): YearMonth {
  const m = /-(\d{4})-(\d{2})$/.exec(id);
  return m ? { y: Number(m[1]), m: Number(m[2]) - 1 } : FIRST_MONTH;
}

function monthStartUtc({ y, m }: YearMonth) {
  return new Date(Date.UTC(y, m, 1, GYE_OFFSET_HOURS));
}

function nextMonth({ y, m }: YearMonth): YearMonth {
  return m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 };
}

function currentMonthGye(): YearMonth {
  const now = new Date(Date.now() - GYE_OFFSET_HOURS * 60 * 60 * 1000);
  return { y: now.getUTCFullYear(), m: now.getUTCMonth() };
}

function monthsSoFar(): YearMonth[] {
  const out: YearMonth[] = [];
  const end = currentMonthGye();
  for (let cur = { ...FIRST_MONTH }; cur.y < end.y || (cur.y === end.y && cur.m <= end.m); cur = nextMonth(cur)) out.push(cur);
  return out;
}

function fmtDate(d: Date | null | undefined) {
  if (!d) return "";
  const g = new Date(d.getTime() - GYE_OFFSET_HOURS * 60 * 60 * 1000);
  return `${String(g.getUTCDate()).padStart(2, "0")}/${String(g.getUTCMonth() + 1).padStart(2, "0")}/${g.getUTCFullYear()}`;
}

function money(n: number) {
  return String(Math.round(n * 100) / 100);
}

// "TND-0003" → "Pago 3"
export function paymentLabel(code: string) {
  const n = Number(/(\d+)\s*$/.exec(code)?.[1] ?? NaN);
  return Number.isFinite(n) ? `Pago ${n}` : code;
}

// Crea (o corrige el nombre de) la pestaña de cada mes que falte. Van primero,
// en orden de mes; las hojas libres de CHEN quedan después.
export async function ensureAutoOrdersTabs(supplierId: string, existing: { id: string; name: string }[]) {
  const byId = new Map(existing.map((t) => [t.id, t.name]));
  let changed = false;
  for (const [i, ym] of monthsSoFar().entries()) {
    const id = autoOrdersTabId(supplierId, ym);
    const name = `Pedidos ${MONTHS[ym.m]} ${ym.y}`;
    if (byId.get(id) === name) continue;
    await prisma.supplierSheetTab.upsert({
      where: { id },
      create: { id, supplierId, name, position: -1000 + i },
      update: { name, position: -1000 + i },
    });
    changed = true;
  }
  return changed;
}

// ---------- Estado de cada pedido ----------

const requestInclude = {
  catalogItem: { select: { name: true, photos: true } },
  receipt: { select: { receivedQuantity: true, confirmedAt: true } },
  debtPayment: { select: { id: true, code: true, closedAt: true } },
  urgentReports: {
    include: {
      resolutions: {
        select: {
          type: true,
          quantity: true,
          status: true,
          credit: { select: { id: true, amount: true, status: true, appliedToGroupId: true } },
          replacementReceivedQty: true,
          replacementArrivedAt: true,
          replacementSubmittedAt: true,
          replacementDueDate: true,
          supplierShippedAt: true,
        },
      },
      excessDebtPayment: { select: { id: true, code: true, closedAt: true } },
    },
    orderBy: { reportedAt: "asc" as const },
  },
} as const;

type RequestRow = Awaited<ReturnType<typeof loadRequests>>[number];

async function loadRequests(where: { supplierId: string; requestedAt?: { gte: Date; lt: Date }; id?: string }) {
  return prisma.purchaseRequest.findMany({
    where: { ...where, status: { notIn: ["PENDING_APPROVAL", "REJECTED"] } },
    include: requestInclude,
    orderBy: [{ requestedAt: "asc" }, { id: "asc" }],
  });
}

// En qué etapa está un pedido — la usa también el aviso de notas de CHEN.
export type OrderStage = "en_camino" | "reposicion" | "por_pagar" | "pago_en_proceso" | "pagado";

export type OrderSummary = {
  requestId: string;
  deptId: string;
  requestedById: string | null;
  requestNumber: number | null;
  productName: string;
  photoUrl: string | null;
  quantity: number;
  unitCost: number;
  requestedAt: Date;
  arrivedAt: Date | null;
  goodQty: number;
  total: number;
  stage: OrderStage;
  statusText: string;
  statusTone: "green" | "amber" | "gray";
  complete: "Sí" | "No" | "—";
  paymentText: string;
  paymentTone: "green" | "amber" | "gray";
  paymentIds: string[];
};

function summarize(r: RequestRow): OrderSummary {
  const reports = r.urgentReports.filter((u) => !u.rejectedAt);
  const onArrivalReports = reports.filter((u) => !u.isLateClaim);
  const blocking = reports.filter((u) => isReportBlockingDebtPayment(u));
  const firstReportAt = onArrivalReports[0]?.reportedAt ?? null;
  const arrivedAt = [r.receipt?.confirmedAt ?? null, firstReportAt].filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

  const replacementsDone = reports.flatMap((u) => u.resolutions).filter((res) => res.type === "REPLACEMENT" && res.status === "COMPLETED");
  const replacedQty = replacementsDone.reduce((s, res) => s + (res.replacementReceivedQty ?? res.quantity), 0);
  const excessQty = reports.filter((u) => u.excessConfirmedAt && u.excessQty > 0).reduce((s, u) => s + u.excessQty, 0);
  const receiptQty = Math.min(r.receipt?.receivedQuantity ?? 0, r.quantity);
  const goodQty = arrivedAt ? receiptQty + replacedQty + excessQty : 0;
  const total = Math.round(goodQty * r.unitCost * 100) / 100;

  // Pago: el de la solicitud y, si hubo, el de las unidades de más.
  const payments = [r.debtPayment, ...reports.map((u) => u.excessDebtPayment)].filter((p): p is { id: string; code: string; closedAt: Date | null } => !!p);
  const uniquePayments = [...new Map(payments.map((p) => [p.id, p])).values()];
  let paymentText = "Pendiente";
  let paymentTone: OrderSummary["paymentTone"] = "gray";
  if (r.debtPayment) {
    const labels = uniquePayments.map((p) => paymentLabel(p.code)).join(", ");
    if (r.debtPayment.closedAt) {
      paymentText = `Pagado — ${labels}`;
      paymentTone = "green";
    } else {
      paymentText = `Pago en proceso — ${labels}`;
      paymentTone = "amber";
    }
  }

  let statusText: string;
  let statusTone: OrderSummary["statusTone"];
  let stage: OrderStage;
  let complete: OrderSummary["complete"];
  if (!arrivedAt) {
    statusText = r.supplierShippingConfirmedAt ? `Enviado por ustedes el ${fmtDate(r.supplierShippingConfirmedAt)} — en camino` : "En camino";
    statusTone = "gray";
    stage = "en_camino";
    complete = "—";
  } else if (blocking.length > 0) {
    const sum = (k: "damagedQty" | "missingQty" | "incompleteQty" | "differentQty") => blocking.reduce((s, u) => s + u[k], 0);
    const parts = [
      sum("damagedQty") ? `${sum("damagedQty")} dañadas` : "",
      sum("missingQty") ? `faltan ${sum("missingQty")}` : "",
      sum("incompleteQty") ? `${sum("incompleteQty")} incompletas` : "",
      sum("differentQty") ? `${sum("differentQty")} distintas` : "",
    ].filter(Boolean);
    const pendingRepl = blocking.flatMap((u) => u.resolutions).filter((res) => res.type === "REPLACEMENT" && res.status === "PENDING");
    let step = "por reponer";
    if (blocking.some((u) => !u.reviewedByLeadAt)) step = "en revisión en bodega";
    else if (pendingRepl.some((res) => res.replacementSubmittedAt)) step = "reposición recibida, en revisión";
    else if (pendingRepl.some((res) => res.supplierShippedAt)) step = "reposición enviada por ustedes";
    else {
      const due = pendingRepl.map((res) => res.replacementDueDate).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0];
      if (due) step = `por reponer hasta el ${fmtDate(due)}`;
    }
    statusText = `${parts.join(", ") || "Con novedad"} — ${step}`;
    statusTone = "amber";
    stage = "reposicion";
    complete = "No";
  } else {
    const parts = ["Bien"];
    if (replacementsDone.length) {
      const lastDone = replacementsDone.map((res) => res.replacementArrivedAt).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0];
      parts.push(`${replacedQty} repuestas${lastDone ? ` el ${fmtDate(lastDone)}` : ""} ✓`);
    }
    if (excessQty) parts.push(`llegaron ${excessQty} de más`);
    statusText = parts.join(" — ");
    statusTone = "green";
    complete = "Sí";
    stage = !r.debtPayment ? "por_pagar" : r.debtPayment.closedAt ? "pagado" : "pago_en_proceso";
  }

  return {
    requestId: r.id,
    deptId: r.deptId,
    requestedById: r.requestedById,
    requestNumber: r.requestNumber,
    productName: r.catalogItem.name,
    photoUrl: r.catalogItem.photos.at(-1) ?? null,
    quantity: r.quantity,
    unitCost: r.unitCost,
    requestedAt: r.requestedAt,
    arrivedAt,
    goodQty,
    total,
    stage,
    statusText,
    statusTone,
    complete,
    paymentText,
    paymentTone,
    paymentIds: uniquePayments.map((p) => p.id),
  };
}

export async function getOrderSummary(supplierId: string, requestId: string): Promise<OrderSummary | null> {
  const [row] = await loadRequests({ supplierId, id: requestId });
  return row ? summarize(row) : null;
}

// ---------- Armado de la pestaña del mes ----------

type SheetStyle = Record<string, unknown> | null;
type LayoutCell = { c: number; v: string; s: SheetStyle };
type LayoutRow = { key: string | null; cells: LayoutCell[]; height?: number };

const tone = (t: "green" | "amber" | "gray") => (t === "green" ? GREEN : t === "amber" ? AMBER : GRAY);
const imageFormula = (url: string | null | undefined) => (url && /^https:\/\//i.test(url) ? `=IMAGEN("${url.replace(/"/g, "")}")` : null);

export async function buildMonthLayout(supplierId: string, tabId: string): Promise<LayoutRow[]> {
  const ym = monthOfTabId(tabId);
  const start = monthStartUtc(ym);
  const end = monthStartUtc(nextMonth(ym));
  const requests = await loadRequests({ supplierId, requestedAt: { gte: start > SUPPLIER_PUBLIC_LINK_START ? start : SUPPLIER_PUBLIC_LINK_START, lt: end } });
  const orders = requests.map(summarize);

  const rows: LayoutRow[] = [];
  const headers = ["Imagen", "Producto", "Pedidas", "Precio", "Fecha pedido", "Estado", "Llegó a bodega", "¿Completo?", "Buenas", "Total", "Pago"];
  rows.push({ key: "h", height: 30, cells: headers.map((v, c) => ({ c, v, s: HEADER })) });

  for (const o of orders) {
    const img = imageFormula(o.photoUrl);
    const st = tone(o.statusTone);
    const pt = tone(o.paymentTone);
    rows.push({
      key: `r:${o.requestId}`,
      height: img ? IMAGE_ROW_H : o.productName.length > 30 || o.statusText.length > 30 ? 34 : undefined,
      cells: [
        { c: 0, v: img ?? "Sin foto", s: img ? null : { al: "center" } },
        { c: 1, v: o.productName, s: { wr: true } },
        { c: 2, v: String(o.quantity), s: { al: "center" } },
        { c: 3, v: money(o.unitCost), s: { fmt: "currency", dp: 2, al: "center" } },
        { c: 4, v: fmtDate(o.requestedAt), s: { al: "center" } },
        { c: 5, v: o.statusText, s: { bg: st.bg, fc: st.fc, wr: true, al: "center" } },
        { c: 6, v: o.arrivedAt ? fmtDate(o.arrivedAt) : "—", s: { al: "center" } },
        { c: 7, v: o.complete, s: { al: "center", b: true, fc: o.complete === "Sí" ? GREEN.fc : o.complete === "No" ? AMBER.fc : GRAY.fc } },
        { c: 8, v: o.arrivedAt ? String(o.goodQty) : "—", s: { al: "center" } },
        { c: 9, v: o.arrivedAt ? money(o.total) : "—", s: o.arrivedAt ? { fmt: "currency", dp: 2, b: true, al: "center" } : { al: "center" } },
        { c: 10, v: o.paymentText, s: { bg: pt.bg, fc: pt.fc, wr: true, al: "center" } },
      ],
    });
  }

  // Pagos (tandas) de estos pedidos, con cada comprobante y su foto.
  const paymentIds = [...new Set(orders.flatMap((o) => o.paymentIds))];
  if (paymentIds.length) {
    const payments = await prisma.supplierDebtPayment.findMany({
      where: { id: { in: paymentIds } },
      include: { transfers: { orderBy: { transferDate: "asc" } } },
      orderBy: { createdAt: "asc" },
    });
    rows.push({ key: null, cells: [] });
    rows.push({ key: "ph", cells: [{ c: 0, v: "PAGOS DE ESTOS PEDIDOS", s: { b: true, fs: 11 } }] });
    rows.push({ key: "ph2", cells: ["Pago", "N° comprobante", "Fecha", "Monto", "Foto"].map((v, c) => ({ c, v, s: HEADER })) });
    for (const p of payments) {
      const label = paymentLabel(p.code);
      p.transfers.forEach((t, i) => {
        const img = imageFormula(t.proofUrl);
        rows.push({
          key: `t:${t.id}`,
          height: img ? PROOF_ROW_H : undefined,
          cells: [
            { c: 0, v: i === 0 ? label : "", s: { b: true } },
            { c: 1, v: t.comprobanteNumber, s: { al: "center" } },
            { c: 2, v: fmtDate(t.transferDate), s: { al: "center" } },
            { c: 3, v: money(t.amount), s: { fmt: "currency", dp: 2, al: "center" } },
            { c: 4, v: img ?? "", s: null },
          ],
        });
      });
      const paid = Math.round(p.transfers.reduce((s, t) => s + t.amount, 0) * 100) / 100;
      const closed = !!p.closedAt;
      rows.push({
        key: `pt:${p.id}`,
        cells: [
          { c: 0, v: `Total ${label}`, s: { b: true } },
          { c: 1, v: closed ? "Pagado ✓" : p.transfers.length ? "Pago en proceso" : "Pago en preparación", s: { b: true, ...(closed ? GREEN : AMBER) } },
          { c: 3, v: money(paid), s: { fmt: "currency", dp: 2, b: true, al: "center" } },
        ],
      });
    }
  }
  return rows;
}

// Confirmado 2026-09-24, pedido explícito del usuario: sin espacio de más —
// cada columna automática mide lo justo para su texto más largo de ESTE mes
// (si todos dicen "Bien", Estado queda angosta; si aparece un texto largo, se
// ensancha sola hasta un tope y baja a dos líneas). Los títulos bajan a dos
// líneas, así que cuentan por su palabra más larga.
const WRAP_CAP: Record<number, number> = { 1: 190, 5: 200, 10: 150 };
function textWidth(text: string, bold: boolean) {
  return Math.ceil(text.length * (bold ? 7.3 : 6.7)) + 14;
}
function fitWidths(layout: LayoutRow[]): Record<string, number> {
  const widths: Record<string, number> = { ...COL_WIDTHS };
  for (const c of AUTO_ORDERS_COLS) {
    if (c === 0) continue; // fotos: ancho fijo
    let w = 44;
    for (const row of layout) {
      const cell = row.cells.find((x) => x.c === c);
      if (!cell || cell.v.startsWith("=")) continue;
      const style = (cell.s ?? {}) as { b?: boolean; fmt?: string };
      const shown = style.fmt === "currency" ? `${Number(cell.v).toFixed(2)}` : cell.v;
      const text = row.key === "h" || row.key === "ph2" ? shown.split(" ").reduce((a, b) => (b.length > a.length ? b : a), "") : shown;
      w = Math.max(w, textWidth(text, !!style.b));
    }
    widths[String(c)] = WRAP_CAP[c] ? Math.min(w, WRAP_CAP[c]) : w;
  }
  return widths;
}

type SheetCell = { r: number; c: number; v: string; s: unknown; a: string | null; e: string | null };
type Anchored = { rowKey: string; col: number; value: string; style: unknown; authorSide: string | null; authorEmail: string | null };

// Arma la pestaña final: lo automático + lo que CHEN escribió, cada cosa en
// la fila de SU pedido/pago. Devuelve también rowKeys (fila → pedido/pago)
// para que la hoja mande a qué pedido pertenece cada celda que se escribe.
export async function mergeAutoOrders<T extends { id: string; colWidths: Record<string, number>; cells: SheetCell[] }>(
  supplierId: string,
  tab: T,
  anchored: Anchored[],
) {
  const layout = await buildMonthLayout(supplierId, tab.id);
  const rowOfKey = new Map<string, number>();
  const cells: SheetCell[] = [];
  const rowHeights: Record<string, number> = {};
  const rowKeys: Record<string, string> = {};
  layout.forEach((row, r) => {
    if (row.key) {
      rowOfKey.set(row.key, r);
      rowKeys[r] = row.key;
    }
    if (row.height) rowHeights[r] = row.height;
    for (const cell of row.cells) cells.push({ r, c: cell.c, v: cell.v, s: cell.s, a: null, e: null });
  });
  for (const a of anchored) {
    const r = rowOfKey.get(a.rowKey);
    if (r === undefined || AUTO_ORDERS_COLS.includes(a.col)) continue;
    cells.push({ r, c: a.col, v: a.value, s: a.style ?? null, a: a.authorSide, e: a.authorEmail });
  }
  return { ...tab, colWidths: { ...fitWidths(layout), ...tab.colWidths }, rowHeights, rowKeys, autoCols: AUTO_ORDERS_COLS, cells };
}

// Filas válidas (con pedido/pago) de una pestaña automática — para validar
// dónde se puede escribir.
export async function autoTabRowKeys(supplierId: string, tabId: string) {
  const layout = await buildMonthLayout(supplierId, tabId);
  return new Set(layout.map((row) => row.key).filter((k): k is string => !!k));
}
