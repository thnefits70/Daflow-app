import { prisma } from "@/lib/prisma";
import { sendPushToOwner, type PushPayload } from "@/lib/webPush";

// Confirmado 2026-08-18: campanita de notificaciones — un solo punto de
// entrada para "avisar en vivo + dejar constancia". Distinto de
// sendPushToOwner solo (que sigue usándose tal cual en el resto de la app
// para avisos que no necesitan quedar listados) — acá además queda una
// fila en Notification para que la persona la pueda repasar después desde
// la campanita, aunque se haya perdido el push en el momento.
export async function notifyOwner(ownerId: string, payload: PushPayload): Promise<void> {
  await prisma.notification.create({
    data: { ownerId, title: payload.title, body: payload.body, url: payload.url },
  });
  await sendPushToOwner(ownerId, payload).catch(() => null);
}

// Confirmado 2026-08-25: bug real — notifyOwner solo inserta, así que un
// mismo aviso reenviado (p.ej. Nairoby reenviando el total de nómina tras un
// rechazo) se apilaba sin fin, y nada marcaba el aviso viejo como resuelto
// cuando el admin aprobaba/rechazaba, así que la campanita seguía diciendo
// "falta tu aprobación" de algo que ya no estaba pendiente. Usar esto antes
// de emitir un aviso de reemplazo, y también en el momento en que el estado
// que anunciaba deja de ser cierto.
export async function resolveNotifications(ownerId: string, title: string, bodyPrefix: string): Promise<void> {
  await prisma.notification.updateMany({
    where: { ownerId, title, body: { startsWith: bodyPrefix }, readAt: null },
    data: { readAt: new Date() },
  });
}
