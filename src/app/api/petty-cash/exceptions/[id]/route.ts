import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminSession } from "@/lib/guards";
import { prisma } from "@/lib/prisma";

const schema = z.object({ decision: z.enum(["approved", "rejected"]) });

// Confirmado 2026-08-05: solo el dueño aprueba/rechaza — al aprobar, el
// desembolso del segundo pago de flete queda habilitado (checkFreightAlreadyPaid
// + hasApprovedException en pettyCash.ts lo dejan pasar).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const updated = await prisma.pettyCashFreightException.update({
    where: { id },
    data: { status: parsed.data.decision, reviewedAt: new Date(), reviewedById: null },
  });

  return NextResponse.json({ ok: true, exception: updated });
}
