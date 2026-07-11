import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const schema = z.object({ hours: z.number().min(0).max(24) });

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session || session.user.role !== "employee") {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const snoozeUntil = parsed.data.hours === 0 ? null : new Date(Date.now() + parsed.data.hours * 3600 * 1000);
  await prisma.user.update({ where: { id: session.user.id }, data: { snoozeUntil } });
  return NextResponse.json({ ok: true });
}
