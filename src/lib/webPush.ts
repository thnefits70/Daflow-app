import webpush from "web-push";
import { prisma } from "@/lib/prisma";

export type PushPayload = { title: string; body: string; url: string };

// Configurado al vuelo (no en el top-level del módulo) — confirmado
// 2026-07-28: Next.js ejecuta este archivo durante "Collecting page data"
// en el build para CUALQUIER ruta que lo importe, incluso sin llegar a
// mandar ninguna notificación. Llamar setVapidDetails() al cargar el
// módulo tumbaba el build entero en cuanto la clave no estaba disponible
// en ese momento — ahora solo se configura la primera vez que de verdad se
// manda un push.
let vapidConfigured = false;
function ensureVapidConfigured() {
  if (vapidConfigured) return;
  webpush.setVapidDetails(
    "mailto:soporte@provedix.com",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  );
  vapidConfigured = true;
}

// Manda la notificación a TODOS los dispositivos que esa persona haya
// activado (celular y laptop a la vez, sin límite) — confirmado 2026-07-28.
// Si una suscripción ya expiró o el permiso fue revocado, el navegador
// responde 404/410 y esa fila se borra sola, para no seguir intentando en
// cada corrida.
export async function sendPushToOwner(ownerId: string, payload: PushPayload) {
  const subs = await prisma.pushSubscription.findMany({ where: { ownerId } });
  if (subs.length === 0) return;

  ensureVapidConfigured();
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
