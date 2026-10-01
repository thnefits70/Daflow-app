// Pedido del usuario 2026-10-01: Dropi publica packs ("Collagen 567g X3")
// con un ID propio. Si ese ID se vincula como "ID alterno" (1:1) del ID
// madre, el corte pide 1 cuando son 3 (pasó con 146702 → 140113). Esto lee
// cuántas unidades dice el nombre, para avisar y proponer la receta.
// Solo es una pista: siempre lo confirma quien sube las guías.
const MAX_PACK = 12;
// Medidas ("20 x 30 cm") no son packs.
const NOT_UNIT = String.raw`(?!\s*(?:cm|mm|m|mts?|pulg|")\b)`;
const PATTERNS = [
  new RegExp(String.raw`\bx\s?(\d{1,2})\b${NOT_UNIT}`, "i"), // X3, x 3
  new RegExp(String.raw`\b(\d{1,2})\s?x\b`, "i"), // 3X, 3 x
  /\bpack\s*(?:de\s*|x\s*)?(\d{1,2})\b/i, // PACK 3, pack de 3, pack x3
  /\b(\d{1,2})\s*(?:unidades|unids?|unds?|pzas?|piezas)\b/i, // 3 unidades
];

export function packCountFromName(name: string): number | null {
  for (const re of PATTERNS) {
    const n = Number(re.exec(name)?.[1]);
    if (n >= 2 && n <= MAX_PACK) return n;
  }
  return null;
}
