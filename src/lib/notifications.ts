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
