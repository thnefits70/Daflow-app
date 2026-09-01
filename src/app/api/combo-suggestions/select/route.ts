import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canViewComboSuggestions } from "@/lib/guards";

// El equipo de Análisis de Mercado marca/desmarca cuáles sugerencias quiere
// mandar a aprobación — reversible mientras siga en SUGERIDO/SELECCIONADO
// (antes de enviar el lote).
const schema = z.object({ ids: z.array(z.string().min(1)).min(1), selected: z.boolean() });

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session || !(await canViewComboSuggestions())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  // admin no es una fila real de User (sentinel id "admin") — nunca se
  // guarda como FK, mismo criterio que reviewedById en la revisión de
  // Control de Compras (purchase-requests/group/[groupId]/review).
  const actorId = session.user.role === "admin" ? null : session.user.id;
  const result = await prisma.comboSuggestion.updateMany({
    where: { id: { in: parsed.data.ids }, status: { in: ["SUGERIDO", "SELECCIONADO"] } },
    data: parsed.data.selected ? { status: "SELECCIONADO", selectedById: actorId } : { status: "SUGERIDO", selectedById: null },
  });
  return NextResponse.json({ ok: true, updated: result.count });
}
