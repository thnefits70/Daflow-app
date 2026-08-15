import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canRegisterPurchaseInvoices } from "@/lib/guards";
import { sendPushToOwner } from "@/lib/webPush";
import { findDuplicatePaymentProofUse, formatPurchaseRequestCode } from "@/lib/purchases";

const schema = z.object({
  proofUrl: z.string().url().nullable().optional(),
  proofReceiptNumber: z.string().trim().nullable().optional(),
});

// Confirmado 2026-08-03: registrar el pago del flete cuando quedó pendiente
// hasta la entrega — separado del pago del producto, que ya pasó antes.
export async function POST(req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const session = await auth();
  if (!(await canRegisterPurchaseInvoices()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { groupId } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const rows = await prisma.purchaseRequest.findMany({ where: { groupId }, include: { catalogItem: { select: { name: true } } } });
  if (rows.length === 0) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  // Confirmado 2026-08-14: guarda extra contra pagar el mismo flete dos
  // veces — complementa el checkFreightAlreadyPaid del lado de Caja Chica
  // (pettyCash.ts), que ya usa este mismo shippingPaidAt como fuente única
  // de verdad sin importar el canal.
  if (rows[0].shippingPaidAt) {
    return NextResponse.json({ error: "El flete ya está pagado." }, { status: 409 });
  }

  const dup = await findDuplicatePaymentProofUse(parsed.data.proofReceiptNumber, groupId);
  if (dup) {
    return NextResponse.json(
      { error: `Ese comprobante ya se usó en otra solicitud (${dup.requestNumber ? formatPurchaseRequestCode(dup.requestNumber) : "otra operación"}) — no se puede reutilizar.` },
      { status: 409 }
    );
  }

  const isAdmin = session.user.role === "admin";
  const paidAt = new Date();
  await prisma.purchaseRequest.updateMany({
    where: { groupId },
    data: {
      shippingPaidAt: paidAt,
      shippingPaymentProofUrl: parsed.data.proofUrl || null,
      shippingPaymentProofReceiptNumber: parsed.data.proofReceiptNumber?.trim() || null,
      shippingPaidById: isAdmin ? null : session.user.id,
    },
  });

  const requestedById = rows[0].requestedById;
  const names = rows.map((r) => r.catalogItem.name).join(", ");
  if (requestedById) {
    await sendPushToOwner(requestedById, {
      title: "Flete pagado",
      body: `Ya se pagó el flete de ${names}`,
      url: "/area/workspace",
    }).catch(() => null);
  }

  // Confirmado 2026-08-14: pedido explícito del usuario — como ahora el
  // flete se puede pagar sin esperar a que Inventario confirme recepción,
  // apenas se paga (si todavía falta esa confirmación) se le avisa a Daniel
  // (líder INV) + admin que hay mercadería pagada pendiente de revisar, para
  // que no se quede sin revisión solo porque nadie se acordó.
  if (rows.some((r) => r.status !== "RECEIVED")) {
    const invLeader = await prisma.user.findFirst({ where: { isLeader: true, leadsDept: { code: "INV" } }, select: { id: true } });
    const reviewTargets = new Set<string>(["admin"]);
    if (invLeader) reviewTargets.add(invLeader.id);
    await Promise.all(
      [...reviewTargets].map((ownerId) =>
        sendPushToOwner(ownerId, {
          title: "📦 Flete pagado — falta revisar la mercadería",
          body: `${names} — ya se pagó el flete, confirma que llegó todo bien`,
          url: ownerId === "admin" ? "/admin" : "/area/workspace",
        }).catch(() => null)
      )
    );
  }

  const updated = await prisma.purchaseRequest.findMany({ where: { groupId } });
  return NextResponse.json(updated);
}
