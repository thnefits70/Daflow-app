import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canActOnMerchandiseReentry } from "@/lib/guards";
import { itemNeedsReview, maybeMarkBatchApproved } from "@/lib/merchandiseReentry";

// "Aprobar lote" (uno) y "Aprobar todos los listos" (en bucle desde el
// cliente) llaman esto mismo — aprueba de un clic únicamente los items que
// NO necesitan revisión manual (IA reconoció + nada dañado). Si el lote
// tuviera algún item que sí necesita revisión, esta ruta simplemente no lo
// toca — se resuelve aparte vía correct-and-approve / resolve-damage.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canActOnMerchandiseReentry()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const batch = await prisma.merchandiseReentryBatch.findUnique({
    where: { id },
    include: { items: true },
  });
  if (!batch) return NextResponse.json({ error: "Lote no encontrado." }, { status: 404 });
  if (!batch.submittedAt) return NextResponse.json({ error: "Este lote todavía no fue enviado." }, { status: 409 });

  const toApprove = batch.items.filter((i) => !i.approvedAt && !itemNeedsReview(i));
  if (toApprove.length > 0) {
    await prisma.merchandiseReentryItem.updateMany({
      where: { id: { in: toApprove.map((i) => i.id) } },
      data: { approvedAt: new Date(), approvedById: session.user.id },
    });
  }
  await maybeMarkBatchApproved(id);

  return NextResponse.json({ approvedCount: toApprove.length });
}
