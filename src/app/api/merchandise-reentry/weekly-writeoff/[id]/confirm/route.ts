import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canCloseMerchandiseReentry } from "@/lib/guards";

// Doble confirmación de Nairoby: ya verificó físicamente el listado que
// Daniel dio de baja en Just contra los productos reales guardados en el
// área designada, y declara que efectivamente se dan de baja.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canCloseMerchandiseReentry()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const batch = await prisma.merchandiseWeeklyWriteOffBatch.findUnique({ where: { id } });
  if (!batch) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (!batch.justWrittenOffAt) return NextResponse.json({ error: "Daniel todavía no dio de baja este lote en Just." }, { status: 409 });
  if (batch.nairobyConfirmedAt) return NextResponse.json({ error: "Ya estaba confirmado." }, { status: 409 });

  const updated = await prisma.merchandiseWeeklyWriteOffBatch
    .update({
      where: { id, nairobyConfirmedAt: null },
      data: { nairobyConfirmedAt: new Date(), nairobyConfirmedById: session.user.role === "admin" ? null : session.user.id },
    })
    .catch(() => null);
  if (!updated) return NextResponse.json({ error: "Ya estaba confirmado." }, { status: 409 });

  return NextResponse.json(updated);
}
