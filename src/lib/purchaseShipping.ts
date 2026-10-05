// Pedido del usuario 2026-10-05 (SC-150, Compel): el flete que cobra el MISMO
// proveedor y se paga "junto con la compra" va en la misma transferencia que
// la mercadería — antes Finanzas solo veía/verificaba los productos y el
// courier quedó sin pagar ($332.93 en vez de $341.29). Sin imports de servidor:
// se usa tanto en las rutas como en los paneles del cliente.
type ShippingRow = {
  supplierId: string;
  carrierId: string | null;
  shippingIncluded: boolean;
  shippingPaymentTiming: "WITH_PURCHASE" | "ON_DELIVERY" | null;
  shippingPaymentMethod: "TRANSFER" | "PETTY_CASH" | null;
  shippingCostTotal: number | null;
  shippingPaidAt: Date | string | null;
};

export function shippingDueWithMerchandise(rows: ShippingRow[]): number {
  const total = rows
    .filter(
      (r) =>
        !r.shippingIncluded &&
        r.shippingPaymentTiming === "WITH_PURCHASE" &&
        r.shippingPaymentMethod !== "PETTY_CASH" &&
        r.carrierId === r.supplierId &&
        !r.shippingPaidAt
    )
    .reduce((s, r) => s + (r.shippingCostTotal ?? 0), 0);
  return Math.round(total * 100) / 100;
}

// shippingCostTotal se guarda REPARTIDO por línea (proporcional a la
// cantidad) — el flete real del pedido es la suma de todas sus líneas, nunca
// el de la primera fila sola.
export function groupShippingTotal(rows: { shippingCostTotal: number | null }[]): number {
  return Math.round(rows.reduce((s, r) => s + (r.shippingCostTotal ?? 0), 0) * 100) / 100;
}
