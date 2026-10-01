// Personas que dejaron de ser líderes. Hasta `lastLeaderMonth` (inclusive)
// las califica el admin como a un líder — el pilar Liderazgo ya lo puso su ex
// equipo en la 360° —; desde el mes siguiente, el líder de su área actual,
// como a cualquier colaborador. Sin dependencias de servidor: se puede
// importar desde componentes cliente.
export const FORMER_LEADERS: { userId: string; name: string; lastLeaderMonth: string }[] = [
  // Pedido del usuario 2026-10-01: Fulfillment se fusionó en INVESTOCK y Yair
  // pasó a asesor de Análisis de Mercado. Septiembre lo califica el admin;
  // desde octubre, Bryan Ríos.
  { userId: "cmrk1e8l60002b0vna4u0g8gs", name: "Yair Urgilez", lastLeaderMonth: "2026-09" },
];

export function formerLeaderOf(userId: string) {
  return FORMER_LEADERS.find((f) => f.userId === userId) ?? null;
}

// ¿En `month` esta persona todavía era líder (la califica el admin)?
export function wasLeaderIn(userId: string, month: string): boolean {
  const f = formerLeaderOf(userId);
  return !!f && month <= f.lastLeaderMonth;
}

// Ex líderes que en `month` todavía eran líderes.
export function formerLeaderIdsFor(month: string): string[] {
  return FORMER_LEADERS.filter((f) => month <= f.lastLeaderMonth).map((f) => f.userId);
}

// Un resumen mensual cuenta como "calificado" solo si tiene la parte que
// califica el evaluador (los 6 pilares). Un líder puede tener ya un resumen
// con solo Liderazgo, que lo pone su equipo en la 360°, sin que el admin lo
// haya calificado todavía — pedido del usuario 2026-10-01.
export function isSummaryComplete(s: { totalScore: number; liderazgoScore: number }): boolean {
  return s.totalScore - s.liderazgoScore > 0;
}
