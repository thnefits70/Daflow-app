import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canCaptureMerchandiseReentry, canActOnMerchandiseReentry } from "@/lib/guards";

// Quitar un producto agregado por error — mientras el lote sigue en
// borrador, lo hace quien lo capturó. Una vez enviado, solo Daniel (líder de
// Inventario, canActOnMerchandiseReentry) puede quitar un ítem, y solo si
// todavía no fue aprobado — pensado para borrar un duplicado que quedó por
// un doble-tap en la captura, no para editar lo ya aprobado.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const item = await prisma.merchandiseReentryItem.findUnique({
    where: { id },
    select: { approvedAt: true, batch: { select: { createdById: true, submittedAt: true } } },
  });
  if (!item) return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  if (!item.batch.submittedAt) {
    if (!(await canCaptureMerchandiseReentry()) || item.batch.createdById !== session.user.id) {
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }
  } else {
    if (!(await canActOnMerchandiseReentry())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    if (item.approvedAt) return NextResponse.json({ error: "Este producto ya fue aprobado — no se puede quitar." }, { status: 409 });
  }

  await prisma.merchandiseReentryItem.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
