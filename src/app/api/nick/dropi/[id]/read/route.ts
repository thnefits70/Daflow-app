import { NextRequest, NextResponse } from "next/server";
import { canAccessNick } from "@/lib/guards";
import { NickReconnectError } from "@/lib/nick/dropiOAuth";
import { readLatestGuides } from "@/lib/nick/dropiMcp";

// "Leer ahora": trae las últimas guías de esa cuenta tal como las ve Dropi.
// Solo lectura y sin montos; no se guarda nada en las guías de DAFLOW.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canAccessNick())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const { id } = await params;
  try {
    return NextResponse.json(await readLatestGuides(id));
  } catch (e) {
    if (e instanceof NickReconnectError) return NextResponse.json({ error: e.message, reconnect: true }, { status: 409 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "No se pudo leer Dropi." }, { status: 502 });
  }
}
