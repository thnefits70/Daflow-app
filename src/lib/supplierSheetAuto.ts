import { prisma } from "@/lib/prisma";
import { SUPPLIER_PUBLIC_LINK_START } from "@/lib/supplierDebt";

// Confirmado 2026-09-24, pedido explícito del usuario: hoja que DAFLOW llena
// sola en el enlace de la hoja de CHEN — A1 "Imagen del producto" y abajo,
// una fila por cada pedido que Compras le hizo a este proveedor desde el
// lunes 21-sep-2026 (SUPPLIER_PUBLIC_LINK_START), ordenados por fecha, con
// la foto del producto en cada celda. Por ahora SOLO esa columna.
// No se guarda en la base: se arma en cada carga (siempre al día) y como su
// id no existe en SupplierSheetTab, la API rechaza cualquier edición
// (antifraude: nadie de CHEN puede cambiar lo que llena DAFLOW).
// Mismo criterio que el enlace de envíos: solo pedidos ya aprobados por
// Bryan (sin PENDING_APPROVAL ni REJECTED); la foto es la última subida al
// matricular el producto (catalogItem.photos), igual que allá.

export const AUTO_ORDERS_TAB_ID = "auto-pedidos";
const IMAGE_ROW_H = 90;

export async function loadAutoOrdersTab(supplierId: string) {
  const requests = await prisma.purchaseRequest.findMany({
    where: {
      supplierId,
      status: { notIn: ["PENDING_APPROVAL", "REJECTED"] },
      requestedAt: { gte: SUPPLIER_PUBLIC_LINK_START },
    },
    select: { requestedAt: true, catalogItem: { select: { photos: true } } },
    orderBy: [{ requestedAt: "asc" }, { id: "asc" }],
  });

  const cells: { r: number; c: number; v: string; s: { b?: boolean; al?: "center" } | null; a: null; e: null }[] = [
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

  return {
    id: AUTO_ORDERS_TAB_ID,
    name: "Pedidos",
    colWidths: { "0": 150 } as Record<string, number>,
    rowHeights,
    locked: true,
    createdBySide: null,
    cells,
  };
}
