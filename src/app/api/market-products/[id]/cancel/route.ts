import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canReviewMarketProduct } from "@/lib/guards";
import { notifyOwner } from "@/lib/notifications";

const schema = z.object({ reason: z.string().trim().min(1, "Falta el motivo.") });

// Pedido del usuario 2026-10-03 (AM-0018 "Casco de Gateo para Bebe"): una
// propuesta ya aprobada que al final no se va a vender quedaba "aprobada"
// para siempre — rechazar su compra en Control de Compras no la cierra (una
// compra rechazada es solo esa compra: precio, cantidad, momento). Esto la
// cancela: pasa a Rechazado con motivo y sale de publicar/listo para comprar.
// Solo si todavía no está publicada en Dropi y no tiene ninguna compra viva
// (pendiente, aprobada o recibida) — si ya hay mercadería o ID real, no es
// cancelar, es dar de baja un producto real. El catálogo provisional se
// queda (la compra rechazada lo referencia) y sigue con awaitingDropiId, así
// que no entra a INVESTOCK ni a duplicados.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || !(await canReviewMarketProduct())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const existing = await prisma.marketProductProposal.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (existing.status !== "APPROVED") return NextResponse.json({ error: "Solo se puede cancelar una propuesta aprobada." }, { status: 409 });
  if (existing.publishedAt || existing.dropiProductId) {
    return NextResponse.json({ error: "Ya está publicada en Dropi — no se puede cancelar desde aquí." }, { status: 409 });
  }
  if (existing.catalogItemId) {
    const live = await prisma.purchaseRequest.count({ where: { catalogItemId: existing.catalogItemId, status: { not: "REJECTED" } } });
    if (live > 0) return NextResponse.json({ error: "Tiene compras en curso o recibidas — no se puede cancelar." }, { status: 409 });
  }

  const updated = await prisma.marketProductProposal.update({
    where: { id },
    data: { status: "REJECTED", rejectReason: `Cancelada después de aprobada: ${parsed.data.reason}`, readyToBuyAt: null, readyToBuyById: null },
  });

  if (existing.proposedById && existing.proposedById !== session.user.id) {
    await notifyOwner(existing.proposedById, {
      title: "Propuesta cancelada",
      body: `${existing.code} ${existing.productName} — ${parsed.data.reason}`,
      url: "/area/workspace?tab=analisis-mercado",
    }).catch(() => null);
  }

  return NextResponse.json(updated);
}
