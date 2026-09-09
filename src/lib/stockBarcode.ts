import QRCode from "qrcode";

// Fase 3 (INVESTOCK) — confirmado 2026-09-09: el código de cada producto es
// el MISMO ID que ya se usa en todos lados (justCode = el ID de Dropi, que
// además es el mismo que usa Just) — nunca un ID nuevo/paralelo. Si un
// producto todavía no tiene justCode (no viene de Just ni de Análisis de
// Mercado), se usa su propio id de DAFLOW como respaldo, para que igual
// pueda tener una etiqueta.
export function stockCodeFor(catalogItem: { id: string; justCode: string | null }): string {
  return catalogItem.justCode ?? catalogItem.id;
}

// Genera el QR como data URL (imagen lista para imprimir) — reutiliza el
// mismo paquete `qrcode` que ya usa la app para el 2FA, solo que acá
// codifica el ID del producto en vez de una URL de autenticador.
export async function generateStockQrDataUrl(code: string): Promise<string> {
  return QRCode.toDataURL(code, { margin: 1, width: 240 });
}
