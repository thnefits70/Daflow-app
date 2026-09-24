import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canSubmitPurchaseRequests } from "@/lib/guards";
import { checkCarrierChoice } from "@/lib/purchases";

const schema = z.object({
  carrierId: z.string().min(1),
  shippingCostTotal: z.number().nonnegative(),
  shippingPaymentMethod: z.enum(["TRANSFER", "PETTY_CASH"]),
  carrierBankAccountId: z.string().min(1).nullable().optional(),
});

// Confirmado 2026-08-11: pedido explícito del usuario — completa el
// transportista y el costo real del flete de una solicitud que se envió con
// "todavía no sé el transportista ni el costo" (shippingCarrierPending). Se
// puede hacer en cualquier estado del grupo, igual que subir la orden de
// compra después. El costo se reparte proporcional por cantidad entre las
// líneas, mismo cálculo que al solicitar. Queda siempre en ON_DELIVERY (ya
// se sabe el costo recién ahora, después de pedida/pagada la mercadería).
// Ampliado 2026-09-15, pedido explícito del usuario: además de completar un
// flete pendiente, esta misma ruta ahora también sirve para CORREGIR uno ya
// completado si Jariel se equivocó (ej. transportista o monto mal puesto) —
// mismo reparto proporcional, así que todos los totales siguen cuadrando.
// El único límite real es shippingPaidAt: en cuanto el flete ya se pagó (por
// transferencia o ya se concilió con caja chica), se congela para siempre —
// corregirlo después rompería la reconciliación ya cerrada.
export async function POST(req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  if (!(await canSubmitPurchaseRequests())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { groupId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const rows = await prisma.purchaseRequest.findMany({ where: { groupId } });
  if (rows.length === 0) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (rows[0].shippingIncluded) {
    return NextResponse.json({ error: "Esta solicitud tiene el flete incluido en el precio — no aplica transportista aparte." }, { status: 409 });
  }
  if (rows[0].shippingPaidAt) {
    return NextResponse.json({ error: "El flete ya está pagado — ya no se puede corregir." }, { status: 409 });
  }
  const carrierError = await checkCarrierChoice({ supplierId: rows[0].supplierId, carrierId: parsed.data.carrierId, carrierBankAccountId: parsed.data.carrierBankAccountId ?? null });
  if (carrierError) return NextResponse.json({ error: carrierError }, { status: 400 });

  const totalQty = rows.reduce((s, r) => s + r.quantity, 0);
  await prisma.$transaction(
    rows.map((r) =>
      prisma.purchaseRequest.update({
        where: { id: r.id },
        data: {
          carrierId: parsed.data.carrierId,
          carrierBankAccountId: parsed.data.carrierBankAccountId || null,
          shippingCostTotal: totalQty > 0 ? (parsed.data.shippingCostTotal * r.quantity) / totalQty : parsed.data.shippingCostTotal,
          shippingPaymentMethod: parsed.data.shippingPaymentMethod,
          shippingCarrierPending: false,
        },
      })
    )
  );

  const updated = await prisma.purchaseRequest.findMany({ where: { groupId } });
  return NextResponse.json(updated);
}
