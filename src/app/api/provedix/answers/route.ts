import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { dbUserId } from "@/lib/guards";
import { deleteAnswer, getCasesRole, saveAnswer } from "@/lib/provedixCases";

// Respuestas que Michelle (la asesora humana) le enseña a Michelle IA (2026-10-15).
const body = z.object({
  id: z.string().max(40).optional(),
  question: z.string().trim().min(3, "Escribe la pregunta.").max(500),
  answer: z.string().trim().min(3, "Escribe la respuesta.").max(2000),
  active: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const role = await getCasesRole();
  if (!role)
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Datos no válidos." },
      { status: 400 },
    );
  await saveAnswer(parsed.data, dbUserId(role.userId));
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  if (!(await getCasesRole()))
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const id = req.nextUrl.searchParams.get("id");
  if (!id)
    return NextResponse.json({ error: "Falta la respuesta." }, { status: 400 });
  await deleteAnswer(id);
  return NextResponse.json({ ok: true });
}
