import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// Marca como leídas todas las notificaciones propias sin leer — se llama
// al abrir la campanita. Pedido de Yair 2026-09-30: con { path, tab } marca
// solo las que apuntan a esa pestaña de esa página (al entrar a la pestaña
// se apaga su punto rojo, ver useWorkspaceTabDots).
export async function POST(req: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const ownerId = session.user.role === "admin" ? "admin" : session.user.id;
  const body = (await req.json().catch(() => null)) as { path?: unknown; tab?: unknown } | null;
  const path = typeof body?.path === "string" ? body.path : null;
  const tab = typeof body?.tab === "string" ? body.tab : null;

  if (path && tab) {
    const unread = await prisma.notification.findMany({
      where: { ownerId, readAt: null, url: { startsWith: path } },
      select: { id: true, url: true },
    });
    const ids = unread
      .filter((n) => {
        try {
          const u = new URL(n.url ?? "", "http://x");
          return u.pathname === path && u.searchParams.get("tab") === tab;
        } catch {
          return false;
        }
      })
      .map((n) => n.id);
    if (ids.length > 0) await prisma.notification.updateMany({ where: { id: { in: ids } }, data: { readAt: new Date() } });
    return NextResponse.json({ ok: true });
  }

  await prisma.notification.updateMany({ where: { ownerId, readAt: null }, data: { readAt: new Date() } });
  return NextResponse.json({ ok: true });
}
