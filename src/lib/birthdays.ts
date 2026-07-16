import { prisma } from "@/lib/prisma";

export type Celebrant = { id: string; name: string; photoUrl: string | null };

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

export async function getUnseenCelebrantsForViewer(viewerId: string): Promise<Celebrant[]> {
  const celebrants = await getTodaysCelebrants();
  if (celebrants.length === 0) return [];

  const celebrationDate = todayAtMidnightUTC();
  const seen = await prisma.birthdayPopupSeen.findMany({
    where: { viewerId, celebrationDate, celebrantId: { in: celebrants.map((c) => c.id) } },
    select: { celebrantId: true },
  });
  const seenIds = new Set(seen.map((s) => s.celebrantId));
  return celebrants.filter((c) => !seenIds.has(c.id));
}

export async function markCelebrantSeen(viewerId: string, celebrantId: string) {
  const celebrationDate = todayAtMidnightUTC();
  await prisma.birthdayPopupSeen.upsert({
    where: { viewerId_celebrantId_celebrationDate: { viewerId, celebrantId, celebrationDate } },
    create: { viewerId, celebrantId, celebrationDate },
    update: {},
  });
}
