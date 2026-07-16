import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { markCelebrantSeen } from "@/lib/birthdays";

const schema = z.object({ celebrantId: z.string().min(1) });

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const viewerId = session.user.role === "admin" ? "admin" : session.user.id;
  await markCelebrantSeen(viewerId, parsed.data.celebrantId);
  return NextResponse.json({ ok: true });
}
