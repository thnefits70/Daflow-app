// Pedido de Daniel 2026-10-13: con CHEN llegaron hidrolavadoras de 2
// baterías en vez de las de 1 batería, y las fotos (fardo + maletín
// cerrado) no lo mostraban. En productos con batería, quien recibe tiene que
// sumar una 3.ª foto con el producto ABIERTO (fuera de la caja o maletín,
// con sus baterías a la vista). Se detecta por el nombre del catálogo —
// sin cargadores (no son el producto con batería).
const BATTERY_PRODUCT = /(hidrolavadora|sopladora|podadora|cortadora de cesped|motosierra|amoladora|aspiradora de mano|bateria)/;

export function needsOpenProductPhoto(productName: string): boolean {
  const n = productName.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ");
  if (/^cargador/.test(n)) return false;
  return BATTERY_PRODUCT.test(n);
}

export const OPEN_PRODUCT_PHOTO_HINT = "Foto 3 (obligatoria, producto con batería): el producto ABIERTO, fuera de su caja o maletín, con sus baterías a la vista.";
