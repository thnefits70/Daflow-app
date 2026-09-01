import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canViewComboSuggestions } from "@/lib/guards";

// Confirmado 2026-08-31: sin integración con Dropi — el equipo de Análisis
// de Mercado crea el combo manualmente allá (sin precio todavía, eso es
// aparte) y solo marca acá que ya quedó hecho.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || !(await canViewComboSuggestions())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const existing = await prisma.comboSuggestion.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (existing.status !== "APROBADO") return NextResponse.json({ error: "Este combo todavía no está aprobado." }, { status: 409 });

  const actorId = session.user.role === "admin" ? null : session.user.id;
  const updated = await prisma.comboSuggestion.update({
    where: { id },
    data: { status: "CREADO_EN_DROPI", createdInDropiAt: new Date(), createdInDropiById: actorId },
  });
  return NextResponse.json(updated);
}
