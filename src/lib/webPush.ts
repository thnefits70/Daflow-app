import webpush from "web-push";
import { prisma } from "@/lib/prisma";

webpush.setVapidDetails(
  "mailto:soporte@provedix.com",
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

export type PushPayload = { title: string; body: string; url: string };

// Manda la notificación a TODOS los dispositivos que esa persona haya
// activado (celular y laptop a la vez, sin límite) — confirmado 2026-07-28.
// Si una suscripción ya expiró o el permiso fue revocado, el navegador
// responde 404/410 y esa fila se borra sola, para no seguir intentando en
// cada corrida.
export async function sendPushToOwner(ownerId: string, payload: PushPayload) {
  const subs = await prisma.pushSubscription.findMany({ where: { ownerId } });
  if (subs.length === 0) return;

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload)
        );
      } catch (err) {
        const statusCode = (err as { statusCode?: number })?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => null);
        }
      }
    })
  );
}
