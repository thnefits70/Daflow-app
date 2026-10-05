import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canAssignExternalSalePack, dbUserId } from "@/lib/guards";
import { notifyColaboradorPackAssigned, notifyGrouperPackAssigned, saleItemsSummary } from "@/lib/externalSales";

// `reassign` (2026-10-01, pedido de Marcos): el líder cambia a quién le tocó
// embalar/entregar mientras todavía no se entregó — no entrega él mismo.
const schema = z.object({ colaboradorId: z.string().min(1), reassign: z.boolean().optional() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canAssignExternalSalePack()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Falta el colaborador." }, { status: 400 });

  const sale = await prisma.externalSale.findUnique({
    where: { id },
    select: { prepReadyAt: true, packAssignedToId: true, deliveredAt: true, dispatchAssignedToId: true, code: true, items: { select: { declaredProductName: true, catalogItem: { select: { name: true } } } } },
  });
  if (!sale) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  // Pedido de Daniel 2026-10-05 (pestaña Despacho): ya se puede elegir quién
  // embala antes de que se agrupe; el aviso a esa persona sale recién en
  // prep-ready.
  const reassign = !!parsed.data.reassign;
  if (sale.packAssignedToId && !reassign) return NextResponse.json({ error: "Ya fue asignada." }, { status: 409 });
  if (reassign) {
    if (!sale.packAssignedToId) return NextResponse.json({ error: "Todavía no tiene a nadie asignado." }, { status: 409 });
    if (sale.deliveredAt) return NextResponse.json({ error: "Ya se entregó, no se puede reasignar." }, { status: 409 });
    if (sale.packAssignedToId === parsed.data.colaboradorId) return NextResponse.json({ error: "Ya está asignada a esa persona." }, { status: 409 });
  }

  // Desde 2026-10-01 (Fulfillment fusionado en INVESTOCK): alguien del equipo
  // de INV que no sea el líder — mismo criterio que pending-pack.
  const colaborador = await prisma.user.findFirst({ where: { id: parsed.data.colaboradorId, department: { code: "INV" }, isActive: true, isLeader: false }, select: { id: true, name: true } });
  if (!colaborador) return NextResponse.json({ error: "Colaborador no encontrado en INVESTOCK." }, { status: 404 });

  const updated = await prisma.externalSale.update({
    where: { id, deliveredAt: null },
    data: { packAssignedToId: colaborador.id, packAssignedAt: new Date(), packAssignedById: dbUserId(session.user.id) },
  });

  if (sale.prepReadyAt) await notifyColaboradorPackAssigned(colaborador.id, sale.code, saleItemsSummary(sale.items));
  if (sale.dispatchAssignedToId) await notifyGrouperPackAssigned(sale.dispatchAssignedToId, sale.code, saleItemsSummary(sale.items), colaborador.name);
  return NextResponse.json(updated);
}
