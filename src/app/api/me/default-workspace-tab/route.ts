import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const schema = z.object({ tab: z.string().min(1).max(30).nullable() });

// Confirmado 2026-08-04: cada quien puede fijar con qué pestaña prefiere que
// abra "Mi área de trabajo", en vez del default por departamento — admin no
// tiene fila real de User, así que para él no hay nada que guardar.
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  if (session.user.role === "admin") return NextResponse.json({ ok: true, skipped: true });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  await prisma.user.update({
    where: { id: session.user.id },
    data: { defaultWorkspaceTab: parsed.data.tab },
  });

  return NextResponse.json({ ok: true });
}
