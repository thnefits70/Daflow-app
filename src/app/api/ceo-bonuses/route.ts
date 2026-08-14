import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canGrantCeoBonus } from "@/lib/guards";
import { sendPushToOwner } from "@/lib/webPush";
import { CEO_BONUS_LABELS } from "@/lib/commissionTiers";

// Historial completo — exclusivo del admin, para su propia referencia.
export async function GET() {
  if (!(await canGrantCeoBonus())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const grants = await prisma.ceoBonusGrant.findMany({
    orderBy: { grantedAt: "desc" },
    include: { user: { select: { name: true } } },
  });
  return NextResponse.json(grants);
}

const schema = z.object({
  userId: z.string().min(1),
  type: z.enum(["ADICIONAL", "PRODUCTIVIDAD", "MERITO"]),
  note: z.string().trim().max(500).optional(),
});

// Confirmado 2026-08-14: solo el admin otorga, y al crearlo ya queda
// aprobado (a diferencia de los montos de nivel que propone Nairoby) —
// dispara push inmediato al destinatario, la celebración se ve al entrar.
export async function POST(req: NextRequest) {
  if (!(await canGrantCeoBonus())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { id: parsed.data.userId }, select: { id: true, name: true } });
  if (!user) return NextResponse.json({ error: "Colaborador no encontrado." }, { status: 404 });

  const grant = await prisma.ceoBonusGrant.create({
    data: { userId: user.id, type: parsed.data.type, note: parsed.data.note || null },
  });

  await sendPushToOwner(user.id, {
    title: "🎉 Recibiste un bono",
    body: CEO_BONUS_LABELS[parsed.data.type],
    url: "/area",
  }).catch(() => null);

  return NextResponse.json(grant, { status: 201 });
}
