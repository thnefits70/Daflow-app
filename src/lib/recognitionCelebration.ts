// Server-only (prisma) — mirrors src/lib/birthdays.ts's "unseen for this
// viewer" pattern, same personalized-for-the-celebrant vs
// generic-for-everyone-else split, just for the monthly recognition podium
// instead of a birthday. Confirmed 2026-07-22: 2° and 3° lugar get their own
// separate celebration popups too (no bono/money involved, just
// recognition+encouragement) — shown one at a time, in rank order.
import { prisma } from "@/lib/prisma";
import { pickRecognitionMessage, pickPodiumMessage } from "@/lib/recognitionMessages";

export type RecognitionCelebration = {
  month: string;
  rank: number;
  winnerId: string;
  winnerName: string;
  winnerPhotoUrl: string | null;
  isMe: boolean;
  message?: string;
};

// The latest confirmed month's top 3, in rank order, minus whichever this
// viewer already dismissed — empty array if nothing's been confirmed yet or
// they've seen all three.
export async function getUnseenRecognitionsForViewer(viewerId: string): Promise<RecognitionCelebration[]> {
  const latestResult = await prisma.monthlyRecognitionResult.findFirst({ orderBy: { month: "desc" } });
  if (!latestResult) return [];
  const month = latestResult.month;

  const [podium, seen] = await Promise.all([
    prisma.monthlyRecognitionResult.findMany({
      where: { month },
      include: { user: { select: { id: true, name: true, photoUrl: true } } },
      orderBy: { rank: "asc" },
    }),
    prisma.monthlyRecognitionPopupSeen.findMany({ where: { viewerId, month } }),
  ]);
  const seenRanks = new Set(seen.map((s) => s.rank));

  return podium
    .filter((p) => !seenRanks.has(p.rank))
    .map((p) => {
      const isMe = p.userId === viewerId;
      return {
        month,
        rank: p.rank,
        winnerId: p.userId,
        winnerName: p.user.name,
        winnerPhotoUrl: p.user.photoUrl,
        isMe,
        message: isMe ? (p.rank === 1 ? pickRecognitionMessage(p.userId, month) : pickPodiumMessage(p.userId, month)) : undefined,
      };
    });
}

export async function markRecognitionSeen(viewerId: string, month: string, rank: number) {
  await prisma.monthlyRecognitionPopupSeen.upsert({
    where: { viewerId_month_rank: { viewerId, month, rank } },
    create: { viewerId, month, rank },
    update: {},
  });
}

export type PodiumEntry = { rank: number; userId: string; name: string; photoUrl: string | null; totalScore: number };

// The latest confirmed month's top 3 — for the compact Inicio widget, shown
// to everyone (not just the winner) until the next month is confirmed.
export async function getLatestPodium(): Promise<{ month: string; podium: PodiumEntry[] } | null> {
  const latest = await prisma.monthlyRecognitionResult.findFirst({ orderBy: { month: "desc" } });
  if (!latest) return null;

  const rows = await prisma.monthlyRecognitionResult.findMany({
    where: { month: latest.month },
    include: { user: { select: { id: true, name: true, photoUrl: true } } },
    orderBy: { rank: "asc" },
  });

  return {
    month: latest.month,
    podium: rows.map((r) => ({ rank: r.rank, userId: r.userId, name: r.user.name, photoUrl: r.user.photoUrl, totalScore: r.totalScore })),
  };
}
