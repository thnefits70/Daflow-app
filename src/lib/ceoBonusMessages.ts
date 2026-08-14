// Mensajes de felicitación para un bono discrecional del CEO — banco
// separado del de Colaborador Destacado (src/lib/recognitionMessages.ts):
// ese es sobre un resultado medido mes a mes, este es sobre una decisión
// puntual del CEO en cualquier momento. Misma firma, mismo mecanismo de
// selección estable (seed userId+grantId, no vuelve a cambiar al recargar).
export const CEO_BONUS_MESSAGE_SIGNATURE = "Andrés Damián, CEO de Provedix";

const CEO_BONUS_MESSAGES = [
  "Vi lo que hiciste, y quise reconocerlo directamente — este bono es por eso.",
  "No todo se mide en una métrica mensual. A veces el esfuerzo se nota antes, y este es el momento de decírtelo.",
  "Quise que supieras que tu trabajo no pasa desapercibido — este bono es un gracias concreto.",
  "Este reconocimiento es decisión mía, y la tomé porque tu esfuerzo se lo ganó.",
  "Hay momentos en que el trabajo bien hecho merece algo más que un gracias de palabra — este es uno de esos momentos.",
  "Te lo ganaste con hechos, no con casualidad. Felicidades.",
  "Este bono no viene de una fórmula — viene de que yo mismo lo noté, y quise reconocerlo.",
  "Gracias por dar ese paso extra que no todos dan. Este bono es por eso, específicamente.",
  "Quiero que sepas que tu esfuerzo se ve, incluso cuando nadie te lo dice todos los días. Hoy te lo digo.",
  "Este reconocimiento es personal — lo decidí yo, pensando en lo que aportaste.",
];

export function pickCeoBonusMessage(userId: string, grantId: string): string {
  const seed = userId + grantId;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return CEO_BONUS_MESSAGES[hash % CEO_BONUS_MESSAGES.length];
}
