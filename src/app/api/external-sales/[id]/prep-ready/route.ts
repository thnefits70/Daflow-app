import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canCaptureMerchandiseOutflow, canActOnMerchandiseOutflow } from "@/lib/guards";
import { notifyFulfilmentLeadExternalSalePrepReady } from "@/lib/externalSales";

const schema = z.object({ photoUrl: z.string().min(1) });

// El colaborador asignado por Daniel (o Daniel, como respaldo) marca que ya
// agrupó y fotografió los productos según la guía — recién ahí pasa al
// equipo de Fulfilment (Yair) para embalar y entregar.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || !(await canCaptureMerchandiseOutflow())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Falta la foto de los productos." }, { status: 400 });

  const sale = await prisma.externalSale.findUnique({
    where: { id },
    select: { dispatchAssignedToId: true, prepReadyAt: true, code: true },
  });
  if (!sale) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  const isAssignee = sale.dispatchAssignedToId === session.user.id;
  if (!isAssignee && !(await canActOnMerchandiseOutflow())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  if (!sale.dispatchAssignedToId) return NextResponse.json({ error: "Todavía no se asigna quién agrupa." }, { status: 409 });
  if (sale.prepReadyAt) return NextResponse.json({ error: "Ya fue marcada como lista." }, { status: 409 });

  const updated = await prisma.externalSale.update({
    where: { id },
    data: { prepPhotoUrl: parsed.data.photoUrl, prepReadyAt: new Date(), prepReadyById: session.user.id },
  });

  await notifyFulfilmentLeadExternalSalePrepReady(sale.code);
  return NextResponse.json(updated);
}
