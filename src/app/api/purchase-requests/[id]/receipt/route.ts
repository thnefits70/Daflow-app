import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canActOnPurchaseReceiving } from "@/lib/guards";
import { sendPushToOwner } from "@/lib/webPush";
import { getMarketingArrivalActorIds } from "@/lib/marketingArrivals";

const schema = z.object({
  receivedQuantity: z.number().int().nonnegative(),
  photoUrls: z.array(z.string().url()).min(2).max(3),
  comment: z.string().trim().optional(),
  aiPhotoMatch: z.boolean().nullable().optional(),
  aiPhotoNote: z.string().nullable().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canActOnPurchaseReceiving()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const existing = await prisma.purchaseRequest.findUnique({ where: { id }, include: { catalogItem: { select: { name: true } } } });
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
  // ahora, si la IA detectó que el producto no corresponde, o si la cantidad
  // recibida no coincide con lo pedido, se bloquea del todo — la única
  // salida es "Informar urgente" (que sí manda notificación con la novedad).
  // Defensa server-side del mismo chequeo que ya deshabilita el botón en
  // el cliente.
  if (parsed.data.aiPhotoMatch === false) {
    return NextResponse.json({ error: "La IA detectó que el producto no corresponde a la referencia — usa 'Informar urgente' en vez de confirmar." }, { status: 409 });
  }
  if (parsed.data.receivedQuantity !== existing.quantity) {
    return NextResponse.json({ error: `La cantidad recibida no coincide con lo pedido (${existing.quantity} un.) — usa 'Informar urgente' para reportar la diferencia.` }, { status: 409 });
  }

  const isAdmin = session.user.role === "admin";
  const [, updated] = await prisma.$transaction([
    prisma.purchaseRequestReceipt.create({
      data: {
        requestId: id,
        receivedQuantity: parsed.data.receivedQuantity,
        photoUrls: parsed.data.photoUrls,
        comment: parsed.data.comment || null,
        aiPhotoMatch: parsed.data.aiPhotoMatch ?? null,
        aiPhotoNote: parsed.data.aiPhotoNote ?? null,
        confirmedById: isAdmin ? null : session.user.id,
      },
    }),
    prisma.purchaseRequest.update({ where: { id }, data: { status: "RECEIVED" } }),
    // Confirmado 2026-08-08: "Mercadería recibida" — se crea vacía apenas
    // Daniel confirma, para que Análisis de Mercado (Robert/Heidy/Jariel) la
    // vea y la vaya confirmando cada quien su parte.
    prisma.purchaseReceiptFollowUp.create({ data: { requestId: id } }),
  ]);

  if (existing.requestedById) {
    await sendPushToOwner(existing.requestedById, {
      title: "Mercadería recibida",
      body: `${existing.catalogItem.name} — Inventario confirmó ${parsed.data.receivedQuantity} un. recibidas`,
      url: "/area/workspace",
    }).catch(() => null);
  }

  const arrivalBody = `${existing.catalogItem.name} · ${parsed.data.receivedQuantity} un.`;
  const [designIds, advisorIds] = await Promise.all([
    getMarketingArrivalActorIds("design"),
    getMarketingArrivalActorIds("advisor"),
  ]);
  await Promise.all([
    ...designIds.map((uid) =>
      sendPushToOwner(uid, { title: "Llegó mercadería a bodega", body: arrivalBody, url: "/area/workspace?tab=llegadas" }).catch(() => null)
    ),
    ...advisorIds.map((uid) =>
      sendPushToOwner(uid, { title: "Llegó mercadería a bodega", body: arrivalBody, url: "/area/workspace?tab=llegadas" }).catch(() => null)
    ),
  ]);

  return NextResponse.json(updated);
}
