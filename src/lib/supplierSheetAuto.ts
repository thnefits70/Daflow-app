import { prisma } from "@/lib/prisma";
import { SUPPLIER_PUBLIC_LINK_START } from "@/lib/supplierDebt";

// Confirmado 2026-09-24, pedido explícito del usuario: pestaña "Pedidos" de
// la hoja de CHEN — A1 "Imagen del producto" y abajo, una fila por cada
// pedido que Compras le hizo a este proveedor desde el lunes 21-sep-2026
// (SUPPLIER_PUBLIC_LINK_START), ordenados por fecha, con la foto del
// producto en cada celda.
// Corregido 2026-09-24, pedido explícito del usuario: la pestaña NO va con
// candado entero — la gente de CHEN escribe lo que quiera en el resto de las
// celdas; solo las columnas que carga DAFLOW (AUTO_ORDERS_COLS) no las cambia
// nadie (la API lo rechaza y ahí recién sale el aviso).
// Confirmado 2026-09-24, pedido explícito del usuario: una pestaña POR MES —
// "Pedidos septiembre 2026" (desde el 21-sep) y, al empezar cada mes nuevo,
// aparece sola "Pedidos octubre 2026", etc., con las mismas columnas en el
// mismo orden. El mes se cuenta en hora de Guayaquil (UTC-5).
// Lo automático no se guarda en la base: se arma en cada carga (siempre al
// día) encima de la pestaña real, que sí guarda lo que escribe la gente.
// Mismo criterio que el enlace de envíos: solo pedidos ya aprobados por
// Bryan (sin PENDING_APPROVAL ni REJECTED); la foto es la última subida al
// matricular el producto (catalogItem.photos), igual que allá.

export const AUTO_ORDERS_COLS = [0];
const IMAGE_ROW_H = 90;
const GYE_OFFSET_HOURS = 5; // Guayaquil = UTC-5, sin horario de verano
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
// Primer mes con pestaña (el 21-sep-2026 cae en septiembre de 2026).
const FIRST_MONTH = { y: 2026, m: 8 };

type YearMonth = { y: number; m: number }; // m: 0 = enero

function ymKey({ y, m }: YearMonth) {
  return `${y}-${String(m + 1).padStart(2, "0")}`;
}

// Septiembre 2026 conserva el id de la pestaña "Pedidos" original, para que
// no se pierda nada de lo que CHEN ya haya escrito ahí.
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

function currentMonthGye(): YearMonth {
  const now = new Date(Date.now() - GYE_OFFSET_HOURS * 60 * 60 * 1000);
  return { y: now.getUTCFullYear(), m: now.getUTCMonth() };
}

// Todos los meses desde septiembre 2026 hasta el mes actual (Guayaquil).
function monthsSoFar(): YearMonth[] {
  const out: YearMonth[] = [];
  const end = currentMonthGye();
  let cur = { ...FIRST_MONTH };
  while (cur.y < end.y || (cur.y === end.y && cur.m <= end.m)) {
    out.push(cur);
    cur = cur.m === 11 ? { y: cur.y + 1, m: 0 } : { y: cur.y, m: cur.m + 1 };
  }
  return out;
}

// Crea (o corrige el nombre de) la pestaña de cada mes que falte. Van primero,
// en orden de mes; las hojas libres de CHEN quedan después.
export async function ensureAutoOrdersTabs(supplierId: string, existing: { id: string; name: string }[]) {
  const months = monthsSoFar();
  const byId = new Map(existing.map((t) => [t.id, t.name]));
  let changed = false;
  for (const [i, ym] of months.entries()) {
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

type SheetCell = { r: number; c: number; v: string; s: unknown; a: string | null; e: string | null };

export async function mergeAutoOrders<T extends { id: string; colWidths: Record<string, number>; cells: SheetCell[] }>(supplierId: string, tab: T) {
  const ym = monthOfTabId(tab.id);
  const start = monthStartUtc(ym);
  const next = monthStartUtc(ym.m === 11 ? { y: ym.y + 1, m: 0 } : { y: ym.y, m: ym.m + 1 });
  const requests = await prisma.purchaseRequest.findMany({
    where: {
      supplierId,
      status: { notIn: ["PENDING_APPROVAL", "REJECTED"] },
      requestedAt: { gte: start > SUPPLIER_PUBLIC_LINK_START ? start : SUPPLIER_PUBLIC_LINK_START, lt: next },
    },
    select: { catalogItem: { select: { photos: true } } },
    orderBy: [{ requestedAt: "asc" }, { id: "asc" }],
  });

  const cells: SheetCell[] = [
    ...tab.cells.filter((c) => !AUTO_ORDERS_COLS.includes(c.c)),
    { r: 0, c: 0, v: "Imagen del producto", s: { b: true, al: "center" }, a: null, e: null },
  ];
  const rowHeights: Record<string, number> = {};
  requests.forEach((req, i) => {
    const r = i + 1;
    const url = req.catalogItem.photos.at(-1);
    if (url && /^https:\/\//i.test(url)) {
      cells.push({ r, c: 0, v: `=IMAGEN("${url.replace(/"/g, "")}")`, s: null, a: null, e: null });
      rowHeights[r] = IMAGE_ROW_H;
    } else {
      cells.push({ r, c: 0, v: "Sin foto", s: { al: "center" }, a: null, e: null });
    }
  });

  return { ...tab, colWidths: { "0": 150, ...tab.colWidths }, rowHeights, autoCols: AUTO_ORDERS_COLS, cells };
}
