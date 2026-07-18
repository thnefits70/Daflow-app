// Congratulatory messages for the Colaborador Destacado del Mes winner —
// deliberately a separate bank from the birthday messages (src/lib/
// birthdays.ts): those are about turning another year older, these are
// about being recognized for real monthly performance and earning the
// bonus. Same signature convention (reads like it comes straight from the
// CEO), same "stable per winner+month, fresh next time" selection.
export const RECOGNITION_MESSAGE_SIGNATURE = "Andrés Damián, CEO de Provedix";

const RECOGNITION_MESSAGES = [
  "Este mes tu esfuerzo no pasó desapercibido — se notó, se midió, y ganaste con méritos propios. Felicidades.",
  "Ser el Colaborador Destacado no es suerte, es la suma de decisiones correctas repetidas todo el mes. Eso hiciste.",
  "Gracias por demostrar, mes a mes, que la excelencia también se construye en los detalles pequeños.",
  "Este reconocimiento es tuyo porque lo trabajaste — con resultados, con compromiso, y con la actitud correcta.",
  "De todo el equipo, tu desempeño este mes fue el que más se destacó. Que este logro te impulse a seguir así.",
  "El bono de este mes es solo una parte del reconocimiento — la otra parte es saber que tu trabajo realmente importa.",
  "Cuando alguien pregunte cómo se ve la excelencia en Provedix, este mes la respuesta eres tú.",
  "No todos los meses son iguales, pero este fue tuyo. Disfrútalo — te lo ganaste.",
  "Tu equipo y tus líderes lo notaron: este mes diste un paso más allá de lo esperado. Gracias por eso.",
  "La consistencia que mostraste este mes es exactamente el tipo de ejemplo que queremos que crezca en Provedix.",
  "Ser reconocido como Colaborador Destacado es la prueba de que el esfuerzo silencioso, tarde o temprano, se ve.",
  "Este mes decidiste dar un poco más en cada tarea — y ese \"poco más\" fue la diferencia. Felicidades.",
  "Que este reconocimiento te recuerde que tu trabajo tiene impacto real, incluso en los días que se sienten rutinarios.",
  "Provedix crece porque hay personas como tú, que convierten el compromiso en resultados todos los meses.",
  "El bono que ganaste este mes es un gracias concreto por un esfuerzo igual de concreto.",
  "De todas las personas evaluadas este mes, tu puntaje habló por sí solo. Sigue así.",
  "Este logro no se trata de ser perfecto, se trata de mejorar constantemente — y eso es justo lo que hiciste.",
  "Que este reconocimiento sea un recordatorio de que tu esfuerzo diario sí se está viendo, y sí se está valorando.",
  "Felicidades — este mes fuiste el ejemplo de lo que significa dar lo mejor de uno mismo en cada tarea.",
  "Ganar este reconocimiento un mes es un logro. Mantenerlo como estándar propio, ese es el verdadero reto — y confío en que lo puedes lograr.",
  "Cada pilar que evaluamos este mes — resultados, excelencia, compromiso, y más — lo reflejaste con creces. Felicidades.",
  "El equipo entero se beneficia cuando alguien eleva la vara como tú lo hiciste este mes. Gracias por eso.",
  "Este reconocimiento, y el bono que lo acompaña, son un simple gracias por un mes nada simple de trabajo bien hecho.",
  "Que este logro te recuerde algo importante: tu esfuerzo de hoy construye la reputación de Provedix de mañana.",
  "Felicidades por ser el Colaborador Destacado de este mes — que te sirva de impulso, no de techo.",
];

// Same celebrant + same month always gets the same message (stable across
// reloads before they dismiss it), but a fresh pick each new win.
export function pickRecognitionMessage(userId: string, month: string): string {
  const seed = userId + month;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return RECOGNITION_MESSAGES[hash % RECOGNITION_MESSAGES.length];
}
