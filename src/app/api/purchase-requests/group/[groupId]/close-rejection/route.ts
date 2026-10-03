import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

const schema = z.object({ note: z.string().trim().min(1, "Escribe por qué no se reenvía.") });

// Pedido del usuario 2026-10-03: una solicitud rechazada que NO se va a
// reenviar (SC-094 "por duplicado", SC-096 "CHEN nos da el mismo precio",
// SC-124 casco) le quedaba a quien la pidió en Inicio como "corregir y
// reenviar · atrasado" para siempre. Esto la cierra con motivo. Mismo dueño
// que resubmit/route.ts: solo quien la pidió (admin = las suyas, null).
export async function POST(req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { groupId } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const rows = await prisma.purchaseRequest.findMany({ where: { groupId }, select: { status: true, requestedById: true, rejectionClosedAt: true } });
  if (rows.length === 0) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  const r0 = rows[0];
  if (r0.status !== "REJECTED") return NextResponse.json({ error: "Solo se cierra una solicitud rechazada." }, { status: 409 });
  if (r0.rejectionClosedAt) return NextResponse.json({ ok: true });

  const isAdmin = session.user.role === "admin";
  const owns = isAdmin ? r0.requestedById === null : r0.requestedById === session.user.id;
  if (!owns) return NextResponse.json({ error: "Solo quien pidió la compra puede cerrarla." }, { status: 403 });

  await prisma.purchaseRequest.updateMany({
    where: { groupId, status: "REJECTED" },
    data: { rejectionClosedAt: new Date(), rejectionClosedNote: parsed.data.note },
  });
  return NextResponse.json({ ok: true });
}
