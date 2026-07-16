import { prisma } from "@/lib/prisma";

export type Celebrant = { id: string; name: string; photoUrl: string | null; message?: string };

export const MESSAGE_SIGNATURE = "Andrés Damián, CEO de Provedix";

// Original messages, not attributed quotes — written to read like they come
// straight from the CEO, since that's the whole point of signing them.
const MOTIVATIONAL_MESSAGES = [
  "Cada año que cumples es una prueba de que sigues avanzando, aunque no siempre lo notes. Sigue así.",
  "El crecimiento no es cómodo, pero es la única forma de convertirte en quien quieres ser. Vas por buen camino.",
  "No mides tu valor por lo rápido que llegas, sino por no dejar de caminar. Feliz nuevo año de vida.",
  "Las personas que más admiro no son las que nunca dudan, sino las que siguen adelante a pesar de la duda. Esa eres tú.",
  "Que este nuevo año te traiga los retos que necesitas para descubrir de qué estás hecho.",
  "Tu mentalidad de hoy construye tus resultados de mañana. Sigue eligiendo crecer.",
  "No hay una versión final de ti — solo la siguiente mejor versión. Ya vas en camino.",
  "La disciplina que aplicas cuando nadie te ve es la que más habla de tu carácter. Sigue así.",
  "Celebra lo lejos que has llegado, y ten hambre de lo lejos que aún puedes llegar.",
  "El éxito no es un destino, es la suma de decisiones pequeñas y constantes. Tú ya las estás tomando.",
  "Que cada obstáculo de este año se convierta en una lección que te haga más fuerte.",
  "La superación no grita, se construye en silencio, día a día. Eso es exactamente lo que veo en ti.",
  "Feliz cumpleaños. Que sigas creyendo en tu propio potencial tanto como yo creo en él.",
  "No existe el momento perfecto para crecer — solo el que decides aprovechar. Sigue decidiendo bien.",
  "Gracias por seguir esforzándote, incluso en los días difíciles. Eso es lo que separa a quienes crecen de quienes se quedan.",
  "Los grandes cambios casi nunca se sienten grandes mientras suceden. Confía en el proceso que ya empezaste.",
  "No se trata de ser el mejor de todos, se trata de ser mejor que quien eras el año pasado.",
  "Cuando dudes de ti, recuerda todo lo que ya lograste creyendo que no podías.",
  "La constancia vence al talento cuando el talento no es constante. Tú ya lo sabes.",
  "Hoy es un buen día para recordarte que mereces todo lo bueno que estás construyendo.",
  "No hay atajos para el crecimiento real, pero cada paso que das cuenta, aunque no lo veas todavía.",
  "Las metas grandes se logran con hábitos pequeños, repetidos con paciencia. Sigue con los tuyos.",
  "Tu actitud frente a los problemas dice más de ti que los problemas mismos. La tuya es admirable.",
  "El miedo y la valentía pueden convivir — lo importante es que sigas avanzando con ambos.",
  "Nadie construye una carrera sólida de la noche a la mañana. Lo tuyo se nota, y se sigue notando.",
  "Cada error que corriges te acerca más a la persona que quieres llegar a ser.",
  "La comodidad no construye grandeza. Y tú llevas tiempo eligiendo salir de ella.",
  "Que este año te traiga la claridad para saber qué quieres, y la disciplina para conseguirlo.",
  "Ser constante en lo pequeño es lo que después parece talento en lo grande.",
  "Confía en tu propio ritmo — no todos florecen al mismo tiempo, y eso está bien.",
  "El esfuerzo silencioso que nadie ve hoy, es el resultado que todos van a ver mañana.",
  "Tu mejor versión no llega por accidente. Llega porque decides trabajar por ella, un día a la vez.",
  "Que sigas rodeándote de retos que te hagan crecer, no de comodidades que te estanquen.",
  "Cada cumpleaños es un buen momento para mirar atrás con orgullo y adelante con hambre.",
  "La disciplina de hoy es la libertad de mañana. Sigue construyendo la tuya.",
  "No compares tu capítulo tres con el capítulo veinte de otra persona. Tu historia va a su propio ritmo.",
  "El crecimiento incómodo de hoy es la fortaleza silenciosa de mañana.",
  "Sigue apostando por ti, incluso en los días donde nadie más lo note.",
  "Las personas que más admiras también tuvieron días de duda. La diferencia es que siguieron.",
  "Que tu ambición nunca se apague, pero que tu paciencia contigo mismo tampoco.",
  "Hoy celebramos otro año de decisiones valientes, aunque no siempre se hayan sentido así.",
  "El verdadero progreso casi nunca es una línea recta. Sigue confiando en tu curva.",
  "Cuídate tanto como cuidas tus responsabilidades — ambas cosas construyen a la misma persona.",
  "Que este nuevo año te reafirme que ir despacio también es ir hacia adelante.",
  "La superación empieza el día que decides dejar de conformarte con lo cómodo.",
  "Tu manera de levantarte después de un mal día dice más de ti que el mal día mismo.",
  "Que cada meta que alcances te haga soñar con una todavía más grande.",
  "Ser mejor persona y mejor profesional no son caminos distintos — tú los estás recorriendo juntos.",
  "El tiempo que inviertes en aprender hoy, es el que te va a ahorrar mañana.",
  "Feliz cumpleaños. Que la versión de ti de aquí a un año esté orgullosa de las decisiones que tomas hoy.",
];

// Same celebrant + same day always gets the same message (stable across
// reloads before they dismiss it), but a fresh pick each new birthday.
function pickMotivationalMessage(celebrantId: string, dateKey: string) {
  const seed = celebrantId + dateKey;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return MOTIVATIONAL_MESSAGES[hash % MOTIVATIONAL_MESSAGES.length];
}

// Server runtime is UTC (Vercel), and an HTML date input round-trips as UTC
// midnight, so comparing month/day in UTC on both sides keeps them in sync —
// same simplification the rest of the app already makes with plain dates.
function matchesToday(date: Date, todayMonth: number, todayDay: number) {
  return date.getUTCMonth() + 1 === todayMonth && date.getUTCDate() === todayDay;
}

function todayAtMidnightUTC() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export async function getTodaysCelebrants(): Promise<Celebrant[]> {
  const now = new Date();
  const month = now.getUTCMonth() + 1;
  const day = now.getUTCDate();

  const users = await prisma.user.findMany({
    where: { birthDate: { not: null } },
    select: { id: true, name: true, photoUrl: true, birthDate: true },
  });
  const celebrants: Celebrant[] = users
    .filter((u) => u.birthDate && matchesToday(u.birthDate, month, day))
    .map((u) => ({ id: u.id, name: u.name, photoUrl: u.photoUrl }));

  const settings = await prisma.platformSettings.findUnique({ where: { id: "singleton" } });
  if (settings?.adminBirthDate && matchesToday(settings.adminBirthDate, month, day)) {
    celebrants.push({ id: "admin", name: "Administrador", photoUrl: settings.logoUrl ?? null });
  }

  return celebrants;
}

export async function getUnseenCelebrantsForViewer(
  viewerId: string
): Promise<(Celebrant & { isMe: boolean })[]> {
  const celebrants = await getTodaysCelebrants();
  if (celebrants.length === 0) return [];

  const celebrationDate = todayAtMidnightUTC();
  const seen = await prisma.birthdayPopupSeen.findMany({
    where: { viewerId, celebrationDate, celebrantId: { in: celebrants.map((c) => c.id) } },
    select: { celebrantId: true },
  });
  const seenIds = new Set(seen.map((s) => s.celebrantId));
  const dateKey = celebrationDate.toISOString().slice(0, 10);

  return celebrants
    .filter((c) => !seenIds.has(c.id))
    .map((c) => {
      const isMe = c.id === viewerId;
      return { ...c, isMe, message: isMe ? pickMotivationalMessage(c.id, dateKey) : undefined };
    });
}

export async function markCelebrantSeen(viewerId: string, celebrantId: string) {
  const celebrationDate = todayAtMidnightUTC();
  await prisma.birthdayPopupSeen.upsert({
    where: { viewerId_celebrantId_celebrationDate: { viewerId, celebrantId, celebrationDate } },
    create: { viewerId, celebrantId, celebrationDate },
    update: {},
  });
}
