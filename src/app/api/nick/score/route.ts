import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/guards";
import { getNickScore } from "@/lib/nick/score";

export const maxDuration = 60;

// Marcador de NICK (Etapa 3): SOLO el admin, incluido el impacto en dinero.
export async function GET() {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  return NextResponse.json(await getNickScore());
}
