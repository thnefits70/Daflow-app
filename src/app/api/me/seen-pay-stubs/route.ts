import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export async function POST() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  // Admin's session id isn't a real User row to update.
  if (session.user.role === "admin") return NextResponse.json({ ok: true });

  await prisma.user.update({ where: { id: session.user.id }, data: { lastSeenPayStubAt: new Date() } });
  return NextResponse.json({ ok: true });
}
