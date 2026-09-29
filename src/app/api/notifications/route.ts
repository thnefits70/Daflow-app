import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// Confirmado 2026-08-18: campanita de notificaciones — cada quien ve solo
// las suyas (ownerId = su propio id, o "admin"). Más reciente primero.
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const ownerId = session.user.role === "admin" ? "admin" : session.user.id;
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
