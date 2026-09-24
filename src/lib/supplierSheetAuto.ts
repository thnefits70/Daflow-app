import { prisma } from "@/lib/prisma";
import { SUPPLIER_PUBLIC_LINK_START } from "@/lib/supplierDebt";

// Confirmado 2026-09-24, pedido explícito del usuario: pestaña "Pedidos" de
// la hoja de CHEN — A1 "Imagen del producto" y abajo, una fila por cada
// pedido que Compras le hizo a este proveedor desde el lunes 21-sep-2026
// (SUPPLIER_PUBLIC_LINK_START), ordenados por fecha, con la foto del
// producto en cada celda.
// Corregido 2026-09-24, pedido explícito del usuario: la pestaña NO va con
// candado entero — cualquiera del equipo escribe lo que quiera en el resto
// de las celdas; solo las columnas que carga DAFLOW (AUTO_ORDERS_COLS) no
// las cambia nadie (la API lo rechaza y ahí recién sale el aviso).
// Lo automático no se guarda en la base: se arma en cada carga (siempre al
// día) encima de la pestaña real, que sí guarda lo que escribe la gente.
// Mismo criterio que el enlace de envíos: solo pedidos ya aprobados por
// Bryan (sin PENDING_APPROVAL ni REJECTED); la foto es la última subida al
// matricular el producto (catalogItem.photos), igual que allá.

export const AUTO_ORDERS_COLS = [0];
const IMAGE_ROW_H = 90;

export function autoOrdersTabId(supplierId: string) {
  return `auto-pedidos-${supplierId}`;
}

export function isAutoOrdersTabId(id: string) {
  return id.startsWith("auto-pedidos-");
}

export async function ensureAutoOrdersTab(supplierId: string) {
  await prisma.supplierSheetTab.upsert({
    where: { id: autoOrdersTabId(supplierId) },
    create: { id: autoOrdersTabId(supplierId), supplierId, name: "Pedidos", position: -1 },
    update: {},
  });
}

type SheetCell = { r: number; c: number; v: string; s: unknown; a: string | null; e: string | null };

export async function mergeAutoOrders<T extends { colWidths: Record<string, number>; cells: SheetCell[] }>(supplierId: string, tab: T) {
  const requests = await prisma.purchaseRequest.findMany({
    where: {
      supplierId,
      status: { notIn: ["PENDING_APPROVAL", "REJECTED"] },
      requestedAt: { gte: SUPPLIER_PUBLIC_LINK_START },
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
