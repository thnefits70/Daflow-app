// Server-only (prisma) — mirrors src/lib/birthdays.ts exactly: same
// "unseen for this viewer" pattern, same personalized-for-the-winner vs
// generic-for-everyone-else split, just for the monthly recognition winner
// instead of a birthday.
import { prisma } from "@/lib/prisma";
import { pickRecognitionMessage } from "@/lib/recognitionMessages";

export type RecognitionCelebration = {
  month: string;
  winnerId: string;
  winnerName: string;
  winnerPhotoUrl: string | null;
  isMe: boolean;
  message?: string;
};

// The latest confirmed month's #1 — null if nothing has ever been
// confirmed, or if this viewer already dismissed it.
export async function getUnseenRecognitionForViewer(viewerId: string): Promise<RecognitionCelebration | null> {
  const latest = await prisma.monthlyRecognitionResult.findFirst({
    where: { rank: 1 },
    orderBy: { month: "desc" },
    include: { user: { select: { id: true, name: true, photoUrl: true } } },
  });
  if (!latest) return null;

  const seen = await prisma.monthlyRecognitionPopupSeen.findUnique({
    where: { viewerId_month: { viewerId, month: latest.month } },
  });
  if (seen) return null;

  const isMe = latest.userId === viewerId;
  return {
    month: latest.month,
    winnerId: latest.userId,
    winnerName: latest.user.name,
    winnerPhotoUrl: latest.user.photoUrl,
    isMe,
    message: isMe ? pickRecognitionMessage(latest.userId, latest.month) : undefined,
  };
}

export async function markRecognitionSeen(viewerId: string, month: string) {
  await prisma.monthlyRecognitionPopupSeen.upsert({
    where: { viewerId_month: { viewerId, month } },
    create: { viewerId, month },
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
