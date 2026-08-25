import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canActOnMerchandiseOutflow } from "@/lib/guards";
import { notifyMarketingLeadOutflowEscalated, outflowItemDisplayName } from "@/lib/merchandiseOutflow";

const schema = z.object({
  resolution: z.enum(["SOLVED_ONSITE", "WRITE_OFF", "ESCALATED_TO_PURCHASES"]),
  note: z.string().trim().min(1).optional(),
});

// Daniel resuelve un ítem de deterioro — SOLVED_ONSITE no deja nada más
// pendiente (pedido explícito del usuario: un daño chico arreglado ahí
// mismo no entra a la cola de baja en Just). WRITE_OFF entra directo a esa
// cola. ESCALATED_TO_PURCHASES avisa a Bryan — el enganche con crédito/
// cambio de proveedor se conecta en una fase posterior.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canActOnMerchandiseOutflow()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  if (parsed.data.resolution !== "SOLVED_ONSITE" && !parsed.data.note) {
    return NextResponse.json({ error: "Explica brevemente qué pasó." }, { status: 400 });
  }

  const item = await prisma.merchandiseOutflowItem.findUnique({
    where: { id },
    include: { batch: { select: { reason: true } }, catalogItem: { select: { name: true } } },
  });
  if (!item) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (item.batch.reason !== "DETERIORO") return NextResponse.json({ error: "Este ítem no es de deterioro." }, { status: 400 });
  if (item.resolution) return NextResponse.json({ error: "Este ítem ya fue resuelto." }, { status: 409 });

  const updated = await prisma.merchandiseOutflowItem.update({
    where: { id },
    data: { resolution: parsed.data.resolution, resolutionNote: parsed.data.note ?? null, resolvedAt: new Date(), resolvedById: session.user.id },
  });

  if (parsed.data.resolution === "ESCALATED_TO_PURCHASES") {
    await notifyMarketingLeadOutflowEscalated({ declaredName: outflowItemDisplayName(item), quantity: item.quantity });
  }

  return NextResponse.json(updated);
}
