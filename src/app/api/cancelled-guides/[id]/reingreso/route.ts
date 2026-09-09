import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canActOnMerchandiseOutflow } from "@/lib/guards";
import { recordKardexEntry } from "@/lib/stockKardex";

// Daniel reingresa a Just — confirmación humana reforzada, exclusivo de él
// (ni siquiera admin, mismo criterio que el resto de acciones de Egresos).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canActOnMerchandiseOutflow()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const report = await prisma.cancelledGuideReport.findUnique({
    where: { id },
    select: {
      batchManagedAt: true,
      fulfillmentRemovedAt: true,
      itemsAssignedAt: true,
      reingresadoAt: true,
      items: { select: { catalogItemId: true, quantity: true } },
    },
  });
  if (!report) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (!report.itemsAssignedAt) return NextResponse.json({ error: "Esta guía todavía no tiene productos cargados." }, { status: 409 });
  if (!report.batchManagedAt) return NextResponse.json({ error: "Bryan todavía no gestionó esta guía con la transportadora." }, { status: 409 });
  if (!report.fulfillmentRemovedAt) return NextResponse.json({ error: "Yair todavía no confirmó que sacó esta guía de Fulfillment." }, { status: 409 });
  if (report.reingresadoAt) return NextResponse.json({ error: "Ya fue reingresada." }, { status: 409 });

  const updated = await prisma.cancelledGuideReport.update({
    where: { id },
    data: { reingresadoAt: new Date(), reingresadoById: session.user.id },
  });

  // Confirmado 2026-09-09 (Fase 3, INVESTOCK): este es el momento real en que
  // la guía cancelada vuelve a stock (Daniel la reingresa a Just) — mismo
  // patrón que el resto de entradas/salidas del Kardex. Ítems sin
  // catalogItemId (declarados solo por nombre) no tienen a qué producto
  // sumarle, se omiten. Secuencial, no en paralelo, porque cada línea
  // depende del saldo que dejó la anterior del mismo producto.
  for (const item of report.items) {
    if (!item.catalogItemId) continue;
    await recordKardexEntry({
      catalogItemId: item.catalogItemId,
      type: "IN",
      quantity: item.quantity,
      unitCost: null,
      occurredAt: new Date(),
    }).catch((err) => console.error("[cancelled-guides reingreso] No se pudo registrar la entrada de Kardex:", err));
  }

  return NextResponse.json(updated);
}
