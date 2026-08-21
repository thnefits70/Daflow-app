import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canCloseMerchandiseReentry } from "@/lib/guards";
import { maybeMarkBatchClosed } from "@/lib/merchandiseReentry";

const schema = z.object({ itemIds: z.array(z.string()).min(1), decision: z.boolean() }); // true = percha de repuestos, false = destruido

// Decisión física final de Nairoby, por unidad, tras la doble confirmación
// del lote semanal. Marca writeOffAt en el item — recién ahí queda
// completamente cerrada la parte dañada del reingreso original.
export async function POST(req: Request) {
  const session = await auth();
  if (!(await canCloseMerchandiseReentry()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const items = await prisma.merchandiseReentryItem.findMany({
    where: { id: { in: parsed.data.itemIds } },
    include: { weeklyWriteOffBatch: { select: { nairobyConfirmedAt: true } } },
  });
  if (items.length !== parsed.data.itemIds.length) return NextResponse.json({ error: "Algún producto ya no existe." }, { status: 404 });
  for (const item of items) {
    if (!item.weeklyWriteOffBatch?.nairobyConfirmedAt) return NextResponse.json({ error: "Falta la doble confirmación del lote semanal." }, { status: 409 });
    if (item.disposalDecision !== null) return NextResponse.json({ error: "Ya tenía una decisión de disposición registrada." }, { status: 409 });
  }

  const now = new Date();
  const actorId = session.user.role === "admin" ? null : session.user.id;
  await prisma.merchandiseReentryItem.updateMany({
    where: { id: { in: parsed.data.itemIds } },
    data: { disposalDecision: parsed.data.decision, disposalDecidedAt: now, disposalDecidedById: actorId, writeOffAt: now, writeOffById: actorId },
  });

  const batchIds = [...new Set(items.map((i) => i.batchId))];
  for (const batchId of batchIds) await maybeMarkBatchClosed(batchId);

  return NextResponse.json({ ok: true });
}
