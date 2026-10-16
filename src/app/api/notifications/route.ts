import { NextResponse, after } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { sendDuePublishNotices } from "@/lib/publishNotices";
import { runNickSyncFromBell } from "@/lib/nick/sync";

// La actualización de NICK corre después de responder y puede tardar ~40 s.
export const maxDuration = 60;

// Confirmado 2026-08-18: campanita de notificaciones — cada quien ve solo
// las suyas (ownerId = su propio id, o "admin"). Más reciente primero.
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const ownerId = session.user.role === "admin" ? "admin" : session.user.id;
  // Pedido de Jariel 2026-10-15: avisos 2 y 3 de "crea el ID en Dropi" — se
  // revisan (como mucho una vez por minuto) con la campanita de quien tenga
  // DAFLOW abierto. Ver publishNotices.ts.
  after(() => sendDuePublishNotices().catch(() => null));
  // NICK etapa 1: estados de guías en Dropi cada 2 h en horario de trabajo
  // (el plan de Vercel no permite tareas más seguidas que diarias).
  after(() => runNickSyncFromBell().catch(() => null));
  const notifications = await prisma.notification.findMany({
    where: { ownerId },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  // Pedido de Jariel 2026-09-29: los avisos viejos de "Stock insuficiente
  // para despachar" se guardaron apuntando al corte de Fulfillment (que
  // Compras no ve). Se corrigen al mostrarlos, sin tocar la base; los nuevos
  // ya se crean con Qué comprar (ver sendLotToInventory).
  return NextResponse.json(
    notifications.map((n) =>
      n.title === "Stock insuficiente para despachar" && n.url?.includes("tab=egresos")
        ? { ...n, url: "/area/workspace?tab=compras&ptab=que-comprar" }
        : n
    )
  );
}
