import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canDecidePurchaseException, getPurchaseGestionManagerId } from "@/lib/guards";
import { notifyPurchaseExceptionDecided, outflowItemDisplayName } from "@/lib/merchandiseOutflow";

const schema = z.object({
  decision: z.enum(["DATA_CORRECTED", "AUTHORIZED", "REJECTED"]),
  note: z.string().trim().min(1, "Explica tu decisión."),
});

// Confirmado 2026-09-17, pedido explícito del usuario: nunca se deja un
// reclamo de deterioro sin trámite solo porque no se encontró la compra que
// lo respalda — admin decide una de tres. DATA_CORRECTED reabre el caso para
// que Jariel vuelva a intentar el vínculo (se limpia el "sin respaldo",
// queda registrado que hubo una corrección). AUTHORIZED deja seguir sin
// compra vinculada, pero SIEMPRE con el nombre y motivo de admin — nunca
// silencioso (ver purchase-resolve/route.ts, que exige justo esta
// autorización para saltarse el ancla). REJECTED cierra el reclamo de una
// vez, con admin como responsable de la decisión.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || !(await canDecidePurchaseException())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const item = await prisma.merchandiseOutflowItem.findUnique({ where: { id }, include: { catalogItem: { select: { name: true } } } });
  if (!item) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (!item.purchaseNoMatchReportedAt) return NextResponse.json({ error: "Este reclamo no tiene ninguna excepción pendiente." }, { status: 409 });
  if (item.purchaseExceptionDecision && item.purchaseExceptionDecision !== "DATA_CORRECTED") {
    return NextResponse.json({ error: "Esta excepción ya fue decidida." }, { status: 409 });
  }

  const now = new Date();
  const notifyTargetId = item.purchaseNoMatchReportedById ?? (await getPurchaseGestionManagerId());

  await prisma.merchandiseOutflowItem.update({
    where: { id },
    data: {
      purchaseExceptionDecision: parsed.data.decision,
      purchaseExceptionNote: parsed.data.note,
      purchaseExceptionDecidedAt: now,
      purchaseExceptionDecidedById: session.user.id,
      // DATA_CORRECTED reabre el caso para Jariel — limpia el "sin
      // respaldo" para que vuelva a aparecer en su cola de pendientes.
      ...(parsed.data.decision === "DATA_CORRECTED"
        ? { purchaseNoMatchReportedAt: null, purchaseNoMatchNote: null, purchaseNoMatchReportedById: null }
        : {}),
      // REJECTED cierra el reclamo de una vez — admin es quien resuelve.
      ...(parsed.data.decision === "REJECTED"
        ? { purchaseResolution: "REJECTED" as const, purchaseResolutionNote: parsed.data.note, purchaseResolvedAt: now, purchaseResolvedById: session.user.id }
        : {}),
    },
  });

  if (notifyTargetId) {
    await notifyPurchaseExceptionDecided({
      managerId: notifyTargetId,
      declaredName: outflowItemDisplayName(item),
      decision: parsed.data.decision,
      note: parsed.data.note,
    }).catch(() => null);
  }

  const finalItem = await prisma.merchandiseOutflowItem.findUnique({ where: { id } });
  return NextResponse.json(finalItem);
}
