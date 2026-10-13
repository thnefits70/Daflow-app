// Pedido de Daniel 2026-10-13: la semana se arma sola con los cortes y cae
// bajo 95% a mitad de semana, así que la explicación del Fill Rate recién se
// le pide el sábado a las 12:00 (hora de Ecuador, UTC-5) de esa semana —
// antes de eso no sale el aviso en Inicio, ni el recuadro rojo, ni bloquea.
// Sin imports de servidor: lo usan también componentes del cliente.
export function fillRateJustificationDueAt(week: string): Date {
  const [yearStr, wStr] = week.split("-W");
  const jan4 = new Date(Date.UTC(Number(yearStr), 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1) + (Number(wStr) - 1) * 7);
  // Sábado = lunes + 5 días; 12:00 en Ecuador = 17:00 UTC.
  return new Date(Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate() + 5, 17));
}

export function fillRateJustificationIsDue(week: string, now: Date = new Date()): boolean {
  return now >= fillRateJustificationDueAt(week);
}
