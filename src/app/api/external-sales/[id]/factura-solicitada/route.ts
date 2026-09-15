import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canInvoiceExternalSale } from "@/lib/guards";

const schema = z.object({ facturaSolicitada: z.enum(["SI", "NO", "PENDIENTE"]) });

// Nairoby corrige si el cliente final pidió factura o no — el asesor declara
// un valor inicial al vender, pero ella es quien está en contacto directo
// con el cliente en la entrega y puede confirmarlo o notar que cambió de
// opinión. Solo tiene efecto real en contra entrega — en pago anticipado la
// factura sigue siendo obligatoria sin importar esto.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canInvoiceExternalSale())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const sale = await prisma.externalSale.findUnique({ where: { id }, select: { deletedAt: true } });
  if (!sale) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (sale.deletedAt) return NextResponse.json({ error: "Esta venta fue cancelada." }, { status: 409 });

  const updated = await prisma.externalSale.update({ where: { id }, data: { facturaSolicitada: parsed.data.facturaSolicitada } });
  return NextResponse.json(updated);
}
