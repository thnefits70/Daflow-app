import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { pushOwnerId } from "@/lib/pushOwner";
import { SILENT_AFTER, deviceLabel, isPhoneUserAgent } from "@/lib/webPush";

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
  tracking: z.boolean().optional(),
  stillSilentAfterReset: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = subscribeSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const ownerId = pushOwnerId(session);
  const userAgent = req.headers.get("user-agent") ?? null;
  // tracking: este celular ya tiene la versión de public/sw.js que responde
  // "lo recibí" — desde ahora se cuentan sus avisos no mostrados (webPush.ts).
  const tracking = parsed.data.tracking === true && isPhoneUserAgent(userAgent);

  const saved = await prisma.pushSubscription.upsert({
    where: { endpoint: parsed.data.endpoint },
    create: {
      ownerId,
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
      userAgent,
      trackingSince: tracking ? new Date() : null,
    },
    update: { ownerId, p256dh: parsed.data.keys.p256dh, auth: parsed.data.keys.auth, userAgent },
    select: { id: true, trackingSince: true, missedCount: true },
  });
  if (tracking && !saved.trackingSince) {
    await prisma.pushSubscription.update({ where: { id: saved.id }, data: { trackingSince: new Date() } });
  }

  const silent = saved.missedCount >= SILENT_AFTER;

  // El celular sigue sin mostrar avisos aunque DAFLOW ya lo volvió a
  // registrar: la persona ve los pasos en pantalla y al admin le llega un
  // aviso — máximo uno por persona y celular cada 24 h.
  if (silent && parsed.data.stillSilentAfterReset === true) {
    const name = ownerId === "admin" ? "Administrador" : (await prisma.user.findUnique({ where: { id: ownerId }, select: { name: true } }))?.name ?? ownerId;
    const bodyPrefix = `${name} · ${deviceLabel(userAgent)}`;
    const recent = await prisma.notification.findFirst({
      where: { ownerId: "admin", title: SILENT_TITLE, body: { startsWith: bodyPrefix }, createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } },
      select: { id: true },
    });
    if (!recent) {
      await prisma.notification.create({
        data: {
          ownerId: "admin",
          title: SILENT_TITLE,
          body: `${bodyPrefix}: los avisos no se le muestran a tiempo, ni después de que DAFLOW lo volvió a registrar solo. Es un ajuste del celular (ahorro de batería o permisos de Chrome); ya le aparecen los pasos en pantalla.`,
          url: null,
        },
      });
    }
  }

  return NextResponse.json({ ok: true, silent });
}

const SILENT_TITLE = "📵 Un celular no está mostrando los avisos";

const unsubscribeSchema = z.object({ endpoint: z.string().url() });

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = unsubscribeSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const ownerId = pushOwnerId(session);
  await prisma.pushSubscription.deleteMany({ where: { endpoint: parsed.data.endpoint, ownerId } });

  return NextResponse.json({ ok: true });
}
