import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canObserveLeader } from "@/lib/guards";
import { currentMonth } from "@/lib/recognition";

// Observación de alguien de OTRA área para un líder — no afecta puntaje, es
// solo informativa (ver LeaderExternalObservation en schema.prisma).
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const leaderId = req.nextUrl.searchParams.get("leaderId");
  if (!leaderId) return NextResponse.json({ error: "Falta leaderId." }, { status: 400 });

  const canObserve = await canObserveLeader(leaderId);
  if (!canObserve) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const month = currentMonth();
  const existing = await prisma.leaderExternalObservation.findUnique({
    where: { month_leaderId_observerId: { month, leaderId, observerId: session.user.id } },
  });

  return NextResponse.json({
    month,
    positiveComment: existing?.positiveComment ?? "",
    improvementComment: existing?.improvementComment ?? "",
    submitted: !!existing,
  });
}

const submitSchema = z.object({
  leaderId: z.string().min(1),
  positiveComment: z.string().trim().min(3, "Contanos algo positivo primero.").max(600),
  improvementComment: z.string().trim().max(600).optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = submitSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }
  const { leaderId, positiveComment, improvementComment } = parsed.data;

  const canObserve = await canObserveLeader(leaderId);
  if (!canObserve) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const month = currentMonth();
  await prisma.leaderExternalObservation.upsert({
    where: { month_leaderId_observerId: { month, leaderId, observerId: session.user.id } },
    create: { month, leaderId, observerId: session.user.id, positiveComment, improvementComment: improvementComment || null },
    update: { positiveComment, improvementComment: improvementComment || null },
  });

  return NextResponse.json({ ok: true });
}
