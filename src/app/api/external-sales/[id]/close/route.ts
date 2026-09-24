import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canCloseExternalSale, dbUserId } from "@/lib/guards";
import { notifyEveryoneExternalSaleClosed } from "@/lib/externalSales";

// Nairoby cierra con el valor completo y toda la trazabilidad — solo
// posible cuando pago y despacho ya están resueltos, sin importar el orden.
// Confirmado 2026-09-21: en pago anticipado la factura ya no bloquea el
// despacho ni la entrega (ver pending-dispatch/route.ts), pero se mantiene
// como requisito para cerrar — así no se pierde de vista una venta sin
// facturar, sin hacer esperar al cliente por eso.
//
// Confirmado 2026-09-24, pedido de Nairoby: justificación opcional de la
// diferencia entre el total y lo que de verdad llegó (ej. VE-0006: el
// motorizado se quedó $9 de flete). "OTRO" exige nota; el flete no, porque
// el comprobante del motorizado ya adjunto es el respaldo.
const differenceSchema = z
  .object({
    receivedAmount: z.number().min(0),
    reason: z.enum(["FLETE_MOTORIZADO", "OTRO"]),
    note: z.string().trim().max(500).optional(),
  })
  .refine((d) => d.reason !== "OTRO" || (d.note?.length ?? 0) >= 3, { message: "Explica brevemente la diferencia." });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canCloseExternalSale()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  let difference: z.infer<typeof differenceSchema> | null = null;
  if (body?.difference) {
    const parsed = differenceSchema.safeParse(body.difference);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
    difference = parsed.data;
  }
  const sale = await prisma.externalSale.findUnique({
    where: { id },
    select: {
      paymentConfirmedAt: true,
      deliveredAt: true,
      nairobyClosedAt: true,
      code: true,
      advisorId: true,
      reviewedById: true,
      invoiceUploadedById: true,
      invoiceUploadedAt: true,
      facturaSolicitada: true,
      dispatchAssignedToId: true,
      packAssignedToId: true,
      deliveredById: true,
      returnedAt: true,
      totalAmount: true,
    },
  });
  if (!sale) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (!sale.paymentConfirmedAt || !sale.deliveredAt) return NextResponse.json({ error: "Falta confirmar el pago y/o la entrega." }, { status: 409 });
  if (sale.nairobyClosedAt) return NextResponse.json({ error: "Ya fue cerrada." }, { status: 409 });
  if (sale.returnedAt) return NextResponse.json({ error: "El asesor reportó que esta venta fue devuelta — no se puede cerrar." }, { status: 409 });
  // Confirmado 2026-09-22: facturaSolicitada === "NO" es la señal real de
  // que el cliente no la pidió (ya sea contra entrega o un asesor B2C
  // vendiendo sin recaudo) — reemplaza el chequeo anterior por isContraEntrega,
  // que ya no distinguía bien ambos casos desde que existe el switch
  // con/sin recaudo por venta.
  if (sale.facturaSolicitada !== "NO" && !sale.invoiceUploadedAt) return NextResponse.json({ error: "Falta subir la factura." }, { status: 409 });

  if (difference && difference.receivedAmount >= sale.totalAmount) return NextResponse.json({ error: "Lo recibido no es menor al total — no hay diferencia que justificar." }, { status: 400 });

  const updated = await prisma.externalSale.update({
    where: { id },
    data: {
      nairobyClosedAt: new Date(),
      nairobyClosedById: dbUserId(session.user.id),
      closeReceivedAmount: difference?.receivedAmount ?? null,
      closeDifferenceReason: difference?.reason ?? null,
      closeDifferenceNote: difference?.note || null,
    },
  });

  await notifyEveryoneExternalSaleClosed(sale);
  return NextResponse.json(updated);
}
