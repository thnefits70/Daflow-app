// Pedido del usuario 2026-10-05: los Suministros nuevos que no traen un
// código de afuera (Just) reciben uno automático: primero las 3 primeras
// letras del nombre, después la marca (SUM) y al final un número de 3 cifras
// que sigue la cuenta de todos los suministros con este formato.
// Ej.: "Papel térmico" → PAP-SUM-001, "Cinta de colores" → CIN-SUM-002.
// Los que ya entraron con código de Just (001, 45679…) se quedan como están.

const STOPWORDS = new Set(["DE", "DEL", "LA", "EL", "LOS", "LAS", "UN", "UNA", "Y", "O", "CON", "PARA", "POR", "EN", "A", "AL"]);

export const SUPPLY_CODE_RE = /^[A-Z0-9]{3}-SUM-(\d{3,})$/;

export function supplyCodePrefix(name: string): string {
  const words = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const useful = words.filter((w) => !STOPWORDS.has(w));
  const letters = (useful.length ? useful : words).join("");
  return (letters + "XXX").slice(0, 3);
}

export function formatSupplyCode(name: string, n: number): string {
  return `${supplyCodePrefix(name)}-SUM-${String(n).padStart(3, "0")}`;
}

export function nextSupplyNumber(existingCodes: (string | null)[]): number {
  let max = 0;
  for (const c of existingCodes) {
    const m = c ? SUPPLY_CODE_RE.exec(c) : null;
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}
