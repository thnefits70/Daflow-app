import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { DRAFT_MAX_AGE_MS } from "@/lib/formDrafts";

// Lista los borradores del colaborador logueado para mostrarlos en Inicio
// (pedido explícito del usuario 2026-09-14: que no se quede "perdido" un
// borrador solo porque la persona se olvidó y nunca volvió a esa pantalla).
// Solo los que tienen label/resumeUrl (los formularios que ya pasan esos
// datos al hook) y no están vencidos.
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json([]);

  const drafts = await prisma.formDraft.findMany({
    where: { userId: session.user.id, label: { not: null }, resumeUrl: { not: null }, updatedAt: { gt: new Date(Date.now() - DRAFT_MAX_AGE_MS) } },
    orderBy: { updatedAt: "desc" },
    select: { id: true, formKey: true, label: true, resumeUrl: true, updatedAt: true },
  });
  return NextResponse.json(drafts);
}
