import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { dbUserId } from "@/lib/guards";
import { closeIfSettled } from "@/lib/stockCount";
import { finishAssignment, startAssignment } from "@/lib/stockCountAssignments";

// La persona asignada empieza (corre su tiempo) o avisa que terminó.
export async function POST(req: NextRequest, { params }: { params: Promise<{ aid: string }> }) {
  const session = await auth();
  const userId = session ? dbUserId(session.user.id) : null;
  if (!userId) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const body = await req.json().catch(() => null);
  const { aid } = await params;
  const r =
    body?.action === "start" ? await startAssignment(aid, userId)
    : body?.action === "finish" ? await finishAssignment(aid, userId, (countId) => closeIfSettled(countId))
    : { ok: false as const, error: "Datos inválidos." };
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });
  return NextResponse.json({ ok: true });
}
