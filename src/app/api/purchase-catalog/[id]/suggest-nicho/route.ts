import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canManageJustCatalog } from "@/lib/guards";
import { suggestNicho } from "@/lib/nichoAi";

// Confirmado 2026-08-31: la IA se llama UNA sola vez por producto — de ahí
// en adelante `nicho` es un campo de texto editable normal (ver PATCH
// abajo), nunca se vuelve a llamar a la IA para el mismo producto salvo que
// alguien la pida explícitamente de nuevo. Mismo gate que el resto del
// catálogo (canManageJustCatalog: Daniel o admin).
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || !(await canManageJustCatalog())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const item = await prisma.purchaseCatalogItem.findUnique({ where: { id }, select: { name: true, description: true } });
  if (!item) return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  const actorId = session.user.role === "admin" ? "admin" : session.user.id;
  let nicho: string;
  try {
    nicho = await suggestNicho(item, actorId);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "No se pudo sugerir un nicho." }, { status: 502 });
  }

  const updated = await prisma.purchaseCatalogItem.update({ where: { id }, data: { nicho }, select: { id: true, nicho: true } });
  return NextResponse.json(updated);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canManageJustCatalog())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const nicho = typeof body?.nicho === "string" ? body.nicho.trim() : null;
  if (!nicho) return NextResponse.json({ error: "Nicho inválido." }, { status: 400 });

  const updated = await prisma.purchaseCatalogItem.update({ where: { id }, data: { nicho }, select: { id: true, nicho: true } });
  return NextResponse.json(updated);
}
