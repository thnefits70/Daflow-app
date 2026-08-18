import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canReceivePurchasesTeam, canActOnPurchaseReceiving, getInventoryLeadId } from "@/lib/guards";
import { sendPushToOwner } from "@/lib/webPush";

const schema = z.object({
  receivedQuantity: z.number().int().nonnegative(),
  photoUrls: z.array(z.string().url()).min(2).max(3),
  // Confirmado 2026-08-18: pedido explícito del usuario — evidencia en video
  // ADEMÁS de la foto (que sigue siendo obligatoria), opcional.
  videoUrls: z.array(z.string().url()).max(2).optional(),
  comment: z.string().trim().optional(),
  aiPhotoMatch: z.boolean().nullable().optional(),
  aiPhotoNote: z.string().nullable().optional(),
  // Confirmado 2026-08-12 (ampliado el mismo día): si la IA marcó que sigue
  // siendo el MISMO producto con una diferencia MENOR (minorDifferenceOnly —
  // color, logo, empaque, etc.), el líder de Inventario puede confirmar con
  // un clic (minorDifferenceConfirmed) y decidir si lo deja pasar o lo
  // reporta — un producto genuinamente distinto sigue bloqueado igual que
  // antes.
  minorDifferenceOnly: z.boolean().nullable().optional(),
  minorDifferenceConfirmed: z.boolean().optional(),
});

// Confirmado 2026-08-18: pedido explícito del usuario — cualquiera del
// equipo de Inventario puede recibir (no solo Daniel), pero esto ya no cierra
// el ciclo — deja el pedido en RECEIVED_PENDING_REVIEW hasta que Daniel lo
// aprueba (ver approve-receipt/route.ts, que es donde de verdad pasa a
// RECEIVED y se notifica a solicitante/marketing).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canReceivePurchasesTeam()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const isAdmin = session.user.role === "admin";
  // Confirmado 2026-08-18: pedido explícito del usuario — unidades y valor
  // pagado son exclusivos de Daniel/admin, el resto del equipo nunca los ve
  // ni siquiera en un mensaje de error.
  const canSeeAmounts = isAdmin || (await canActOnPurchaseReceiving());

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const existing = await prisma.purchaseRequest.findUnique({
    where: { id },
    include: { catalogItem: { select: { name: true } }, urgentReports: true },
  });
  if (!existing) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (existing.status !== "PAID") return NextResponse.json({ error: "Todavía no está pagada." }, { status: 409 });
  // Confirmado 2026-08-06: sin la orden de compra, Daniel no tiene el
  // respaldo completo de qué se pidió — no se puede cerrar el ciclo de
  // recepción hasta que quien solicitó la suba.
  if (!existing.purchaseOrderUrl) {
    return NextResponse.json({ error: "Falta que suban la orden de compra — no se puede confirmar la recepción todavía." }, { status: 409 });
  }

  // Fix confirmado 2026-08-08: cambio de política pedido explícitamente por
  // el usuario — antes esto era puramente informativo (nunca bloqueaba);
  // ahora, si la IA detectó que el producto no corresponde, se bloquea del
  // todo — la única salida es "Informar urgente" (que sí manda notificación
  // con la novedad). Defensa server-side del mismo chequeo que ya
  // deshabilita el botón en el cliente.
  const minorDifferenceOverride = parsed.data.aiPhotoMatch === false && !!parsed.data.minorDifferenceOnly && !!parsed.data.minorDifferenceConfirmed;
  if (parsed.data.aiPhotoMatch === false && !minorDifferenceOverride) {
    return NextResponse.json({ error: "La IA detectó que el producto no corresponde a la referencia — usa 'Informar urgente' en vez de confirmar." }, { status: 409 });
  }

  // Confirmado 2026-08-11: pedido explícito del usuario — si ya hay un
  // "reporte urgente" sobre esta solicitud (dañada/incompleta/diferente), se
  // puede confirmar la cantidad BUENA (lo pedido menos lo reportado) para
  // que esa parte siga el proceso normal de venta sin esperar a que se
  // resuelva lo administrativo con el proveedor — eso se sigue rastreando
  // aparte (ver openReportsForGroup en Finanzas/Auditoría) hasta que se
  // cubra con reemplazo, reembolso/crédito o write-off.
  const totalAffected = existing.urgentReports.reduce(
    (s, r) => s + r.damagedQty + r.incompleteQty + r.differentQty + r.missingQty,
    0
  );
  const expectedQuantity = existing.quantity - totalAffected;
  if (totalAffected > 0 && expectedQuantity <= 0) {
    return NextResponse.json({ error: "Ya se reportó como afectado el 100% de lo pedido — no hay cantidad buena que confirmar." }, { status: 409 });
  }
  if (parsed.data.receivedQuantity !== expectedQuantity) {
    const msg = canSeeAmounts
      ? totalAffected > 0
        ? `La cantidad buena a confirmar es ${expectedQuantity} un. (${existing.quantity} pedidas menos ${totalAffected} ya reportadas).`
        : `La cantidad recibida no coincide con lo pedido (${existing.quantity} un.) — usa 'Informar urgente' para reportar la diferencia.`
      : "La cantidad no coincide con lo registrado — vuelve a contar. Si de verdad llegó una cantidad distinta, usa 'Informar urgente' para reportarlo.";
    return NextResponse.json({ error: msg }, { status: 409 });
  }

  const [, updated] = await prisma.$transaction([
    prisma.purchaseRequestReceipt.create({
      data: {
        requestId: id,
        receivedQuantity: parsed.data.receivedQuantity,
        photoUrls: parsed.data.photoUrls,
        videoUrls: parsed.data.videoUrls ?? [],
        comment: parsed.data.comment || null,
        aiPhotoMatch: parsed.data.aiPhotoMatch ?? null,
        aiPhotoNote: parsed.data.aiPhotoNote ?? null,
        minorDifferenceConfirmed: minorDifferenceOverride,
        confirmedById: isAdmin ? null : session.user.id,
      },
    }),
    // Confirmado 2026-08-18: pedido explícito del usuario — todavía no es
    // RECEIVED de verdad, queda pendiente de que Daniel apruebe (ver
    // approve-receipt/route.ts, que es donde se crea PurchaseReceiptFollowUp
    // y se avisa a solicitante/marketing, igual que antes hacía esta ruta).
    prisma.purchaseRequest.update({ where: { id }, data: { status: "RECEIVED_PENDING_REVIEW" } }),
  ]);

  const leadId = await getInventoryLeadId();
  if (leadId) {
    await sendPushToOwner(leadId, {
      title: "Recepción pendiente de tu aprobación",
      body: `${existing.catalogItem.name} — ${parsed.data.receivedQuantity} un. recibidas por el equipo, esperando que apruebes.`,
      url: "/area/workspace?tab=compras&ptab=inventario",
    }).catch(() => null);
  }

  return NextResponse.json(updated);
}
