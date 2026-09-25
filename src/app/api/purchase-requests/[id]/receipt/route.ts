import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canReceivePurchasesTeam, canActOnPurchaseReceiving } from "@/lib/guards";
import { notifyReceiptRegistered } from "@/lib/purchaseReceiptFromReport";

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
  // Confirmado 2026-09-25, pedido explícito del usuario: el equipo de
  // Inventario declara el lote de caducidad al confirmar que llegó (antes se
  // preguntaba recién en la aprobación de Daniel). hasExpiration: la
  // respuesta a "¿tiene fecha de caducidad?" — si es true, va el lote.
  hasExpiration: z.boolean().optional(),
  expirationLot: z
    .object({
      manufactureDate: z.string().trim().min(1).nullable().optional(),
      expirationDate: z.string().trim().min(1),
      quantity: z.number().int().positive(),
    })
    .optional(),
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
    include: {
      catalogItem: { select: { name: true, hasExpiration: true, awaitingDropiId: true } },
      urgentReports: true,
      supplier: { select: { paymentMode: true } },
    },
  });
  if (!existing) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  // Confirmado 2026-09-08 (Fase 1, proveedores con crédito): un proveedor de
  // crédito (hoy solo CHEN) nunca pasa por "PAID" antes de recibir — se
  // recibe primero, y el pago real ocurre después, agrupado en una tanda
  // (ver SupplierDebtPayment). Para pago anticipado, el comportamiento no
  // cambia: sigue exigiendo PAID.
  const isCreditSupplier = existing.supplier.paymentMode === "CREDITO";
  if (existing.status !== "PAID" && !(isCreditSupplier && existing.status === "APPROVED")) {
    return NextResponse.json({ error: "Todavía no está pagada." }, { status: 409 });
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

  // Un producto pendiente de ID Dropi declara su lote después, al liberarse
  // al Kardex (ver approve-receipt/route.ts) — acá no se pide.
  // Fix 2026-09-25 (Scott quedó bloqueado): un celular con la pantalla vieja
  // abierta (cargada antes de este cambio) no muestra la pregunta ni manda
  // hasExpiration — ahí no se bloquea: queda sin declarar (null) y Daniel
  // lo declara al aprobar, como antes.
  const clientAsks = parsed.data.hasExpiration !== undefined || parsed.data.expirationLot !== undefined;
  const asksExpiration = clientAsks && !existing.catalogItem.awaitingDropiId;
  const hasExpiration = asksExpiration && (existing.catalogItem.hasExpiration || parsed.data.hasExpiration === true);
  const lot = hasExpiration ? parsed.data.expirationLot : undefined;
  if (asksExpiration && !existing.catalogItem.hasExpiration && parsed.data.hasExpiration === undefined) {
    return NextResponse.json({ error: "Falta responder si el producto tiene fecha de caducidad." }, { status: 400 });
  }
  if (hasExpiration && !lot) {
    return NextResponse.json({ error: "Este producto tiene caducidad — falta la fecha de vencimiento y la cantidad del lote." }, { status: 400 });
  }
  if (lot && lot.quantity > parsed.data.receivedQuantity) {
    return NextResponse.json({ error: "La cantidad del lote no puede ser mayor a la cantidad recibida." }, { status: 400 });
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
        expirationDeclared: asksExpiration ? hasExpiration : null,
        lotManufactureDate: lot?.manufactureDate ? new Date(lot.manufactureDate) : null,
        lotExpirationDate: lot ? new Date(lot.expirationDate) : null,
        lotQuantity: lot?.quantity ?? null,
      },
    }),
    // Confirmado 2026-08-18: pedido explícito del usuario — todavía no es
    // RECEIVED de verdad, queda pendiente de que Daniel apruebe (ver
    // approve-receipt/route.ts, que es donde de verdad pasa a RECEIVED y se
    // notifica al solicitante, además de correr el Kardex).
    prisma.purchaseRequest.update({ where: { id }, data: { status: "RECEIVED_PENDING_REVIEW" } }),
    // Confirmado 2026-09-16, pedido explícito del usuario: antes esta fila
    // (y el aviso a Análisis de Mercado/despacho de abajo) se creaba recién
    // en approve-receipt/route.ts, cuando Daniel aprobaba. Ahora se crea acá
    // mismo, apenas bodega registra la recepción — Robert/Heidy/Jariel/Yair
    // ya pueden confirmar su parte sin esperar la aprobación de Daniel, que
    // ahora solo importa para Compras (costo real, Kardex, cierre del ciclo
    // de compra). getMarketingArrivals() en marketingArrivals.ts se ajustó
    // para mostrar tanto RECEIVED_PENDING_REVIEW como RECEIVED.
    prisma.purchaseReceiptFollowUp.create({ data: { requestId: id } }),
  ]);

  await notifyReceiptRegistered({ catalogItemId: existing.catalogItemId, itemName: existing.catalogItem.name, quantity: parsed.data.receivedQuantity });

  return NextResponse.json(updated);
}
