import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { dbUserId } from "@/lib/guards";
import {
  caseConversation,
  getCasesRole,
  resolveCase,
} from "@/lib/provedixCases";

// GET: conversación completa del caso. POST: marcarlo resuelto (y enseñar la respuesta a Michelle IA).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await getCasesRole()))
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const { id } = await params;
  return NextResponse.json(await caseConversation(id));
}

const body = z.object({
  resolution: z.string().trim().min(3, "Escribe cómo se resolvió.").max(2000),
  reply: z.string().trim().max(1000).optional(),
  teach: z
    .object({ question: z.string().max(500), answer: z.string().max(2000) })
    .nullable()
    .optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const role = await getCasesRole();
  if (!role)
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Datos no válidos." },
      { status: 400 },
    );
  const { id } = await params;
  const error = await resolveCase(id, dbUserId(role.userId), parsed.data);
  if (error) return NextResponse.json({ error }, { status: 409 });
  return NextResponse.json({ ok: true });
}
