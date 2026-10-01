// Pedido del usuario 2026-09-30: desde este mes el KPI de Garantías se llena
// solo con los cortes (Yair marca el motivo de cada garantía al subir las
// guías de Dropi). Los meses anteriores quedan como se cargaron a mano. Sin
// dependencias de servidor: lo usa también WarrantyPanel ("use client").
export const WARRANTY_AUTO_SINCE_MONTH = "2026-10";
// Último mes que se puede cargar/corregir a mano.
export const WARRANTY_LAST_MANUAL_MONTH = "2026-09";

export const isAutoWarrantyMonth = (month: string) => month >= WARRANTY_AUTO_SINCE_MONTH;
