import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canActOnPurchaseReceiving } from "@/lib/guards";

const schema = z.object({
  missingQty: z.number().int().nonnegative(),
  note: z.string().trim().min(1, "Explica cómo se resolvió internamente."),
});

// Confirmado 2026-09-08: pedido explícito de Daniel — cuando lo faltante de
// un "Informar urgente" se resuelve hablando con su propio equipo (ej. se
// encontró mal ubicado en bodega, o fue un mal conteo), no hace falta
// mandarlo a Compras ni notificar a admin/solicitante (a diferencia de
// approve/route.ts, que siempre escala). Solo aplica si el reporte es
// puramente cantidad faltante — si tiene algo dañado/incompleto/diferente,
// eso sigue su camino normal a Compras. Además de cerrar el reporte, corrige
// receivedQuantity del recibo (si ya existe) para que "Aprobar recepción"
// deje de mostrar la alerta de cantidad faltante.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canActOnPurchaseReceiving()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const existing = await prisma.purchaseRequestUrgentReport.findUnique({
    where: { id },
    include: { request: { select: { id: true, quantity: true, receipt: { select: { id: true } } } } },
  });
  if (!existing) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (existing.reviewedByLeadAt) return NextResponse.json({ error: "Ya fue revisado." }, { status: 409 });
  if (existing.isLateClaim) return NextResponse.json({ error: "Un reclamo posterior al cierre no se puede resolver por acá." }, { status: 400 });

  const flaggedQty = existing.damagedQty + existing.incompleteQty + existing.differentQty;
  if (flaggedQty > 0) {
    return NextResponse.json({ error: "Este reporte tiene unidades dañadas/incompletas/diferentes — debe enviarse a Compras." }, { status: 400 });
  }

  const finalMissingQty = parsed.data.missingQty;
  if (finalMissingQty > existing.request.quantity) {
    return NextResponse.json({ error: `No puede dejar el total en más de lo pedido (${existing.request.quantity} un.).` }, { status: 400 });
  }

  const isAdmin = session.user.role === "admin";
  const now = new Date();
  const [updated] = await prisma.$transaction([
    prisma.purchaseRequestUrgentReport.update({
      where: { id },
      data: {
        missingQty: finalMissingQty,
        reviewedByLeadId: isAdmin ? null : session.user.id,
        reviewedByLeadAt: now,
        resolvedInternallyById: isAdmin ? null : session.user.id,
        resolvedInternallyAt: now,
        resolvedInternallyNote: parsed.data.note,
      },
    }),
    ...(existing.request.receipt
      ? [
          prisma.purchaseRequestReceipt.update({
            where: { requestId: existing.request.id },
            data: { receivedQuantity: existing.request.quantity - finalMissingQty },
          }),
        ]
      : []),
  ]);

  return NextResponse.json(updated);
}
