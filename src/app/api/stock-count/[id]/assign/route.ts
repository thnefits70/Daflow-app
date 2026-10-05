import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canActOnMerchandiseOutflow, dbUserId } from "@/lib/guards";
import { assignArea } from "@/lib/stockCountAssignments";

const schema = z.object({ area: z.string().min(1).max(10), assigneeId: z.string().min(1), dueAt: z.string().min(1) });

// Daniel asigna un área (o el recuento) a una persona con un horario.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || !(await canActOnMerchandiseOutflow())) return NextResponse.json({ error: "Solo el líder de Inventarios asigna el conteo." }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  const { id } = await params;
  const r = await assignArea({ countId: id, ...parsed.data, byId: dbUserId(session.user.id) });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });
  return NextResponse.json({ ok: true });
}
