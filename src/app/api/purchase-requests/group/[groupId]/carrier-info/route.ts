import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canSubmitPurchaseRequests } from "@/lib/guards";

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
export async function POST(req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  if (!(await canSubmitPurchaseRequests())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { groupId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const rows = await prisma.purchaseRequest.findMany({ where: { groupId } });
  if (rows.length === 0) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (!rows[0].shippingCarrierPending) {
    return NextResponse.json({ error: "Esta solicitud no tiene el flete pendiente de completar." }, { status: 409 });
  }

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
