import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { DRAFT_MAX_AGE_MS } from "@/lib/formDrafts";

// Guardado automático de formularios en progreso (pedido de Daniel
// 2026-09-14): cada colaborador puede tener, por formKey, un borrador
// guardado silenciosamente mientras escribe. Si sale a revisar otra pantalla
// y vuelve, el formulario carga solo lo que ya tenía. Se borra al enviar el
// formulario con éxito (ver clearDraft en useFormDraft). Ver también
// /api/form-drafts/mine, que lista estos borradores para mostrarlos en
// Inicio.

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const key = req.nextUrl.searchParams.get("key");
  if (!key) return NextResponse.json({ error: "Falta la clave del formulario." }, { status: 400 });

  const draft = await prisma.formDraft.findUnique({ where: { userId_formKey: { userId: session.user.id, formKey: key } } });
  if (!draft || Date.now() - draft.updatedAt.getTime() > DRAFT_MAX_AGE_MS) return NextResponse.json({ data: null });
  return NextResponse.json({ data: draft.data, updatedAt: draft.updatedAt });
}

const putSchema = z.object({
  key: z.string().trim().min(1),
  data: z.unknown(),
  label: z.string().trim().min(1).optional(),
  resumeUrl: z.string().trim().min(1).optional(),
});

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  await prisma.formDraft.upsert({
    where: { userId_formKey: { userId: session.user.id, formKey: parsed.data.key } },
    create: { userId: session.user.id, formKey: parsed.data.key, data: parsed.data.data as object, label: parsed.data.label, resumeUrl: parsed.data.resumeUrl },
    update: { data: parsed.data.data as object, label: parsed.data.label, resumeUrl: parsed.data.resumeUrl },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const key = req.nextUrl.searchParams.get("key");
  if (!key) return NextResponse.json({ error: "Falta la clave del formulario." }, { status: 400 });

  await prisma.formDraft.deleteMany({ where: { userId: session.user.id, formKey: key } });
  return NextResponse.json({ ok: true });
}
