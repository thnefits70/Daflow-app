import { NextRequest, NextResponse } from "next/server";
import { canAccessNick } from "@/lib/guards";
import { revokeAndClear } from "@/lib/nick/dropiOAuth";

// Quita el permiso de Dropi de esa cuenta (también se lo avisa a Dropi).
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canAccessNick())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const { id } = await params;
  await revokeAndClear(id);
  return NextResponse.json({ ok: true });
}
