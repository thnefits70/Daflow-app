import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { dbUserId } from "@/lib/guards";
import { canWriteSuddenDemandNote, saveSuddenDemandNote } from "@/lib/suddenDemand";

const schema = z.object({ note: z.string().max(500) });

// Nota libre de Jariel sobre un producto que despierta ("ya pedí 50", "lo
// tengo en cuenta"). La ven todos, Daniel también en Base de datos de productos.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const isAdmin = session.user.role === "admin";
  const userId = dbUserId(session.user.id);
  if (!(await canWriteSuddenDemandNote(userId, isAdmin))) return NextResponse.json({ error: "Solo Jariel escribe esta nota." }, { status: 403 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "La nota puede tener hasta 500 letras." }, { status: 400 });

  const { id } = await ctx.params;
  const userName = isAdmin ? "Administrador" : session.user.name ?? "Sin nombre";
  const result = await saveSuddenDemandNote({ alertId: id, note: parsed.data.note, userId, userName });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 });
  return NextResponse.json({ ok: true });
}
