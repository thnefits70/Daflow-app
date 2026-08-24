import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canActOnPurchaseInvoices } from "@/lib/guards";

const schema = z.object({ note: z.string().trim().min(1).nullable() });

// Confirmado 2026-08-06: opcional, no obligatorio — Nairoby la usa solo si
// algo no cuadra en su revisión final de la operación. note: null la quita.
export async function POST(req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const session = await auth();
  if (!(await canActOnPurchaseInvoices()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { groupId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const isAdmin = session.user.role === "admin";
  await prisma.purchaseRequest.updateMany({
    where: { groupId },
    data: parsed.data.note
      ? { financeFlagNote: parsed.data.note, financeFlaggedAt: new Date(), financeFlaggedById: isAdmin ? null : session.user.id }
      : { financeFlagNote: null, financeFlaggedAt: null, financeFlaggedById: null },
  });

  return NextResponse.json({ ok: true });
}
