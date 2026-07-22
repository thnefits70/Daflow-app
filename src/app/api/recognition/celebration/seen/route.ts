import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { markRecognitionSeen } from "@/lib/recognitionCelebration";

const schema = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), rank: z.number().int().min(1).max(3) });

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const viewerId = session.user.role === "admin" ? "admin" : session.user.id;
  await markRecognitionSeen(viewerId, parsed.data.month, parsed.data.rank);
  return NextResponse.json({ ok: true });
}
