// Sin imports de servidor: lo usan también las pantallas.

// Reparte una cantidad a comprar según lo que se vendió de cada variante
// (resto mayor, para que la suma dé exacto). Con menos de 5 unidades con
// variante no se sugiere reparto: es muy poco para saber.
export const MIX_MIN_UNITS = 5;
export function splitByVariant(qty: number, variants: { label: string; units: number }[]): { label: string; qty: number }[] {
  const total = variants.reduce((s, v) => s + v.units, 0);
  if (qty <= 0 || total === 0) return [];
  const raw = variants.map((v) => ({ label: v.label, exact: (qty * v.units) / total }));
  const out = raw.map((r) => ({ label: r.label, qty: Math.floor(r.exact), rest: r.exact - Math.floor(r.exact) }));
  let left = qty - out.reduce((s, o) => s + o.qty, 0);
  for (const o of [...out].sort((a, b) => b.rest - a.rest)) {
    if (left <= 0) break;
    o.qty += 1;
    left -= 1;
  }
  return out.filter((o) => o.qty > 0).map(({ label, qty }) => ({ label, qty }));
}
