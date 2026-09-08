import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { currentMonth } from "@/lib/recognition";

// Observación de cualquier colaborador no-líder para el admin — comment-
// only, mismo patrón que leader-observation. Los líderes usan
// admin-feedback en su lugar (ellos sí dan una nota numérica).
export async function GET() {
  const session = await auth();
  if (!session || session.user.role !== "employee") return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const me = await prisma.user.findUnique({ where: { id: session.user.id }, select: { isLeader: true } });
  if (!me || me.isLeader) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const month = currentMonth();
  const existing = await prisma.adminLeadershipObservation.findUnique({
    where: { month_observerId: { month, observerId: session.user.id } },
  });

  return NextResponse.json({
    month,
    positiveComment: existing?.positiveComment ?? "",
    improvementComment: existing?.improvementComment ?? "",
    submitted: !!existing,
  });
}

const submitSchema = z.object({
  positiveComment: z.string().trim().min(3, "Contanos algo positivo primero.").max(600),
  improvementComment: z.string().trim().max(600).optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session || session.user.role !== "employee") return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const me = await prisma.user.findUnique({ where: { id: session.user.id }, select: { isLeader: true } });
  if (!me || me.isLeader) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = submitSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }
  const { positiveComment, improvementComment } = parsed.data;

  const month = currentMonth();
  await prisma.adminLeadershipObservation.upsert({
    where: { month_observerId: { month, observerId: session.user.id } },
    create: { month, observerId: session.user.id, positiveComment, improvementComment: improvementComment || null },
    update: { positiveComment, improvementComment: improvementComment || null },
  });

  return NextResponse.json({ ok: true });
}
