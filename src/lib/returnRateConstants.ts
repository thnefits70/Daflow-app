// Pedido del usuario 2026-09-30: desde octubre 2026 la Tasa de Devolución se
// calcula sola con los cortes (lo que sale) y Reingreso de Mercadería (lo que
// regresa). Hasta septiembre queda lo que se copió a mano de ATOM. Sin
// dependencias de servidor: lo usa también ReturnRatePanel ("use client").
export const RETURN_RATE_AUTO_SINCE_MONTH = "2026-10";
export const RETURN_RATE_LAST_MANUAL_MONTH = "2026-09";

export const isAutoReturnRateMonth = (month: string) => month >= RETURN_RATE_AUTO_SINCE_MONTH;
