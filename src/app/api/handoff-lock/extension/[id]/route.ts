import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { decideIdExtension } from "@/lib/handoffLocks";

const schema = z.object({ grant: z.boolean() });

// Solo el admin da más tiempo después de la prórroga automática (2026-10-15).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (session?.user.role !== "admin") return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  const r = await decideIdExtension((await params).id, parsed.data.grant);
  return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.error }, { status: 409 });
}
