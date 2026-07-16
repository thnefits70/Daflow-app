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
