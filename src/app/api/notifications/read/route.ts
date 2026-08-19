import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// Marca como leídas todas las notificaciones propias sin leer — se llama
// al abrir la campanita.
export async function POST() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const ownerId = session.user.role === "admin" ? "admin" : session.user.id;
  await prisma.notification.updateMany({ where: { ownerId, readAt: null }, data: { readAt: new Date() } });
  return NextResponse.json({ ok: true });
}
