import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canGrantCeoBonus } from "@/lib/guards";
import { notifyOwner } from "@/lib/notifications";
import { CEO_BONUS_LABELS } from "@/lib/commissionTiers";
import { isValidPeriod } from "@/lib/payroll";

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
  type: z.enum(["ADICIONAL", "PRODUCTIVIDAD", "MERITO", "PERSONALIZADO"]),
  note: z.string().trim().max(500).optional(),
  amount: z.number().positive().optional(),
  targetPeriod: z.string().optional(),
});

// Confirmado 2026-08-14: solo el admin otorga, y al crearlo ya queda
// aprobado (a diferencia de los montos de nivel que propone Nairoby) —
// dispara push inmediato al destinatario, la celebración se ve al entrar.
// Confirmado 2026-09-11: PERSONALIZADO exige monto y quincena exactos —
// a diferencia de los 3 tipos fijos, acá el admin elige ambos. Se rechaza
// si la quincena elegida ya fue generada (ese rol ya no se recalcula solo;
// habría que agregarlo a mano ahí con "Agregar concepto").
export async function POST(req: NextRequest) {
  if (!(await canGrantCeoBonus())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const { userId, type, note, amount, targetPeriod } = parsed.data;

  if (type === "PERSONALIZADO") {
    if (!amount) return NextResponse.json({ error: "Ingresá el monto del bono." }, { status: 400 });
    if (!targetPeriod || !isValidPeriod(targetPeriod)) return NextResponse.json({ error: "Elegí la quincena donde se paga." }, { status: 400 });
    const existingPeriod = await prisma.payrollPeriod.findUnique({ where: { period: targetPeriod } });
    if (existingPeriod) return NextResponse.json({ error: `La quincena ${targetPeriod} ya fue generada — agregalo a mano en ese rol con "Agregar concepto".` }, { status: 409 });
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true } });
  if (!user) return NextResponse.json({ error: "Colaborador no encontrado." }, { status: 404 });

  const grant = await prisma.ceoBonusGrant.create({
    data: {
      userId: user.id,
      type,
      note: note || null,
      amount: type === "PERSONALIZADO" ? amount : null,
      targetPeriod: type === "PERSONALIZADO" ? targetPeriod : null,
    },
  });

  await notifyOwner(user.id, {
    title: "🎉 Recibiste un bono",
    body: type === "PERSONALIZADO" ? `$${amount!.toFixed(2)} — se paga en la quincena ${targetPeriod}` : CEO_BONUS_LABELS[type],
    url: "/area",
  }).catch(() => null);

  return NextResponse.json(grant, { status: 201 });
}
