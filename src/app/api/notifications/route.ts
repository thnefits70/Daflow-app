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
  return NextResponse.json(notifications);
}
