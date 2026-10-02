import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { dbUserId } from "@/lib/guards";
import { canDiscardSuggestions, undoDiscard } from "@/lib/purchaseSuggestions";

// "Volver a la lista": el producto descartado vuelve a compras frías.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const userId = dbUserId(session.user.id);
  if (!(await canDiscardSuggestions(userId, session.user.role === "admin"))) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const { id } = await params;
  const result = await undoDiscard({ discardId: id, userId });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
