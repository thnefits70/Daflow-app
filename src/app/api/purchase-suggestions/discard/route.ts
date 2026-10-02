import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { dbUserId } from "@/lib/guards";
import { canDiscardSuggestions, discardSuggestion } from "@/lib/purchaseSuggestions";

const schema = z.object({ catalogItemId: z.string().min(1), reason: z.string().min(1), note: z.string().max(500).nullable().optional() });

// Pedido del usuario 2026-10-02: "No hace falta comprarlo" en compras frías
// (la doble confirmación es en pantalla). Avisa al líder de Análisis de
// Mercado y al admin.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const userId = dbUserId(session.user.id);
  if (!(await canDiscardSuggestions(userId, session.user.role === "admin"))) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  const result = await discardSuggestion({
    catalogItemId: parsed.data.catalogItemId,
    reason: parsed.data.reason,
    note: parsed.data.note ?? null,
    userId,
    actorName: session.user.name ?? "Alguien",
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
