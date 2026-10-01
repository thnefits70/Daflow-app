import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canMarkComboCreatedInDropi } from "@/lib/guards";

// La asesora B2B marca/desmarca cuáles sugerencias quiere mandar a
// aprobación — reversible mientras siga en SUGERIDO/SELECCIONADO. Pedido del
// usuario 2026-09-30: solo ella elige (según su propio análisis); el resto de
// Análisis de Mercado solo mira.
const schema = z.object({ ids: z.array(z.string().min(1)).min(1), selected: z.boolean() });

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session || !(await canMarkComboCreatedInDropi())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const result = await prisma.comboSuggestion.updateMany({
    where: { id: { in: parsed.data.ids }, status: { in: ["SUGERIDO", "SELECCIONADO"] } },
    data: parsed.data.selected ? { status: "SELECCIONADO", selectedById: session.user.id } : { status: "SUGERIDO", selectedById: null },
  });
  return NextResponse.json({ ok: true, updated: result.count });
}
