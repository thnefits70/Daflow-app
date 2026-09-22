import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const schema = z.object({ facturaSolicitada: z.enum(["SI", "NO"]) });

// Confirmado 2026-09-21: Nairoby ya no puede corregir esto (ver
// ExternalSaleInvoiceInbox.tsx) — el asesor dueño de la venta es la única
// fuente de esta respuesta, sin importar el estado de revisión/despacho.
// Existe porque quitarle la edición completa (items, cliente, etc.) a una
// venta ya aprobada sigue siendo correcto (ver PATCH en route.ts), pero
// dejaba sin forma de resolver el valor "PENDIENTE" a las ventas contra
// entrega que ya fueron aprobadas antes de que existiera esta pregunta.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const sale = await prisma.externalSale.findUnique({
    where: { id },
    select: { advisorId: true, deletedAt: true, advisor: { select: { externalSaleContraEntrega: true } } },
  });
  if (!sale) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (sale.advisorId !== session.user.id && session.user.role !== "admin") return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  if (sale.deletedAt) return NextResponse.json({ error: "Esta venta fue cancelada." }, { status: 409 });
  // Confirmado 2026-09-22: depende del perfil del asesor (B2C), no de
  // isContraEntrega de esta venta puntual — un asesor B2C vendiendo "sin
  // recaudo" también puede tener clientes que no pidan factura.
  if (!sale.advisor.externalSaleContraEntrega) return NextResponse.json({ error: "Esta venta es de un asesor B2B, la factura ya es obligatoria." }, { status: 409 });

  const updated = await prisma.externalSale.update({ where: { id }, data: { facturaSolicitada: parsed.data.facturaSolicitada } });
  return NextResponse.json(updated);
}
