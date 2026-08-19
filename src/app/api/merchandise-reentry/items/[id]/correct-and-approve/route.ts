import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canApproveMerchandiseReentry } from "@/lib/guards";
import { itemNeedsReview, maybeMarkBatchApproved } from "@/lib/merchandiseReentry";

const schema = z.object({ name: z.string().trim().min(1).max(200) });

// Daniel corrige (o confirma tal cual) el nombre puesto a mano por el
// colaborador y aprueba el item en el mismo clic — "Guardar y aprobar" en
// el boceto. Si el item todavía tiene unidades dañadas sin resolver, esto
// SOLO guarda el nombre — la aprobación real espera a resolve-damage.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canApproveMerchandiseReentry()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Nombre inválido." }, { status: 400 });

  const item = await prisma.merchandiseReentryItem.findUnique({ where: { id }, include: { batch: { select: { submittedAt: true } } } });
  if (!item) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (!item.batch.submittedAt) return NextResponse.json({ error: "Este lote todavía no fue enviado." }, { status: 409 });

  const stillNeedsReview = itemNeedsReview({ ...item, correctedName: parsed.data.name });
  const updated = await prisma.merchandiseReentryItem.update({
    where: { id },
    data: {
      correctedName: parsed.data.name,
      correctedById: session.user.role === "admin" ? null : session.user.id,
      correctedAt: new Date(),
      ...(stillNeedsReview
        ? {}
        : { approvedAt: item.approvedAt ?? new Date(), approvedById: item.approvedById ?? (session.user.role === "admin" ? null : session.user.id) }),
    },
  });

  await maybeMarkBatchApproved(item.batchId);
  return NextResponse.json(updated);
}
