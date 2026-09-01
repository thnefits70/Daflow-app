import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canAssignExternalSalePack } from "@/lib/guards";
import { notifyColaboradorPackAssigned, saleItemsSummary } from "@/lib/externalSales";

const schema = z.object({ colaboradorId: z.string().min(1) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canAssignExternalSalePack()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Falta el colaborador." }, { status: 400 });

  const sale = await prisma.externalSale.findUnique({
    where: { id },
    select: { prepReadyAt: true, packAssignedToId: true, code: true, items: { select: { declaredProductName: true, catalogItem: { select: { name: true } } } } },
  });
  if (!sale) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (!sale.prepReadyAt) return NextResponse.json({ error: "Inventario todavía no la deja lista." }, { status: 409 });
  if (sale.packAssignedToId) return NextResponse.json({ error: "Ya fue asignada." }, { status: 409 });

  const colaborador = await prisma.user.findFirst({ where: { id: parsed.data.colaboradorId, department: { code: "FUL" } }, select: { id: true } });
  if (!colaborador) return NextResponse.json({ error: "Colaborador no encontrado en Fulfilment." }, { status: 404 });

  const updated = await prisma.externalSale.update({
    where: { id },
    data: { packAssignedToId: colaborador.id, packAssignedAt: new Date(), packAssignedById: session.user.id },
  });

  await notifyColaboradorPackAssigned(colaborador.id, sale.code, saleItemsSummary(sale.items));
  return NextResponse.json(updated);
}
