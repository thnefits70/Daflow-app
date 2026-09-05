import webpush from "web-push";
import { prisma } from "@/lib/prisma";

export type PushPayload = { title: string; body: string; url: string };

// Confirmado 2026-08-05: el ícono de la notificación debe ser el logo real
// que se sube en Configuración (faviconUrl), no un ícono genérico fijo —
// cacheado un rato para no consultar la base de datos en cada notificación,
// ya que este dato casi nunca cambia.
let cachedIcon: { url: string | null; fetchedAt: number } | null = null;
const ICON_CACHE_MS = 5 * 60 * 1000;

async function getNotificationIcon(): Promise<string | null> {
  if (cachedIcon && Date.now() - cachedIcon.fetchedAt < ICON_CACHE_MS) return cachedIcon.url;
  const settings = await prisma.platformSettings.findUnique({ where: { id: "singleton" }, select: { faviconUrl: true } });
  cachedIcon = { url: settings?.faviconUrl ?? null, fetchedAt: Date.now() };
  return cachedIcon.url;
}

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
  const icon = await getNotificationIcon();
  const body = JSON.stringify(icon ? { ...payload, icon } : payload);
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body
        );
      } catch (err) {
        const statusCode = (err as { statusCode?: number })?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => null);
        } else {
          // Confirmado 2026-07-29: antes cualquier error que no fuera 404/410
          // se descartaba en silencio — si el push fallaba por otra razón
          // (VAPID mal configurado, payload inválido, etc.) nadie se
          // enteraba nunca. Ahora queda en los logs de Vercel para poder
          // diagnosticar sin adivinar.
          console.error(`sendPushToOwner falló (ownerId=${ownerId}, statusCode=${statusCode}):`, err);

          // Confirmado 2026-09-05: los logs de Vercel no los revisa nadie en
          // el día a día, así que además queda un aviso en la campanita del
          // admin — inserción directa (no notifyOwner) para no reintentar el
          // push que ya sabemos que falló.
          const message = err instanceof Error ? err.message : String(err);
          await prisma.notification.create({
            data: {
              ownerId: "admin",
              title: "⚠️ Un push no se pudo enviar",
              body: `Destinatario: ${ownerId}${statusCode ? ` · código ${statusCode}` : ""} · ${message}`,
              url: null,
            },
          }).catch(() => null);
        }
      }
    })
  );
}
