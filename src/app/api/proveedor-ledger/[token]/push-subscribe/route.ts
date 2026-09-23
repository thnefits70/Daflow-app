import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { findSupplierByPublicShippingToken } from "@/lib/supplierDebt";
import { isSupplierShippingPushOwnerId, supplierShippingPushOwnerId } from "@/lib/supplierShippingPush";

// Confirmado 2026-09-23, pedido explícito del usuario: el equipo de despacho
// de CHEN activa avisos push desde el enlace "solo envíos". Sin auth() a
// propósito (no tienen cuenta) — el acceso es SOLO por el token de envíos
// (nunca el del saldo). La suscripción queda guardada bajo el proveedor,
// no bajo una persona.
const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

async function resolveOwnerId(token: string) {
  const supplier = await findSupplierByPublicShippingToken(token);
  if (!supplier || supplier.paymentMode !== "CREDITO") return null;
  return supplierShippingPushOwnerId(supplier.id);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ownerId = await resolveOwnerId(token);
  if (!ownerId) return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  const parsed = subscribeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  // Nunca "robarle" la suscripción a alguien de DAFLOW (solo pasaría si el
  // mismo navegador y dominio ya estaba suscrito como colaborador).
  const existing = await prisma.pushSubscription.findUnique({ where: { endpoint: parsed.data.endpoint } });
  if (existing && !isSupplierShippingPushOwnerId(existing.ownerId)) {
    return NextResponse.json({ error: "Este navegador ya tiene otras notificaciones activas." }, { status: 409 });
  }

  const userAgent = req.headers.get("user-agent") ?? null;
  await prisma.pushSubscription.upsert({
    where: { endpoint: parsed.data.endpoint },
    create: { ownerId, endpoint: parsed.data.endpoint, p256dh: parsed.data.keys.p256dh, auth: parsed.data.keys.auth, userAgent },
    update: { ownerId, p256dh: parsed.data.keys.p256dh, auth: parsed.data.keys.auth, userAgent },
  });
  return NextResponse.json({ ok: true });
}

const unsubscribeSchema = z.object({ endpoint: z.string().url() });

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ownerId = await resolveOwnerId(token);
  if (!ownerId) return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  const parsed = unsubscribeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  await prisma.pushSubscription.deleteMany({ where: { endpoint: parsed.data.endpoint, ownerId } });
  return NextResponse.json({ ok: true });
}
