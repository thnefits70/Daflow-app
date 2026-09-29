import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canConfirmPersonalPurchaseTransfer } from "@/lib/guards";
import { notifyOwner } from "@/lib/notifications";

// Confirmado 2026-09-29: pedido del usuario — como confirm-transfer ahora
// cierra la operación y exige que la IA haya leído el monto exacto, cuando
// no coincide (o no lo pudo leer) el admin devuelve el pedido al colaborador
// para que suba el comprobante correcto. Vuelve a PENDING_TRANSFER_PROOF;
// transferAiNote se conserva para que el colaborador vea por qué.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canConfirmPersonalPurchaseTransfer())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const order = await prisma.personalPurchaseOrder.findUnique({ where: { id } });
  if (!order) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (order.status !== "PENDING_ADMIN_CONFIRM") return NextResponse.json({ error: "Ya fue procesado." }, { status: 409 });

  const updated = await prisma.personalPurchaseOrder.update({
    where: { id },
    data: {
      status: "PENDING_TRANSFER_PROOF",
      transferProofUrl: null,
      transferProofName: null,
      transferProofUploadedAt: null,
      transferAiReadAmount: null,
      transferAiMatch: null,
    },
  });

  await notifyOwner(order.employeeId, {
    title: "🧾 Sube otra vez tu comprobante",
    body: `${order.transferAiNote ?? "El comprobante no muestra el monto exacto."} Debe decir $${order.totalAmount?.toFixed(2)}.`,
    url: "/area/compras-personales",
  });

  return NextResponse.json(updated);
}
