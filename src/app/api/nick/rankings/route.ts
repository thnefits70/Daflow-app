import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/guards";
import { getNickRankings } from "@/lib/nick/rankings";

// Rankings de NICK: SOLO el admin (pedido del usuario 2026-10-16).
export async function GET(req: NextRequest) {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const p = req.nextUrl.searchParams;
  return NextResponse.json(
    await getNickRankings({
      days: Number(p.get("days")) || 30,
      account: p.get("account") || null,
      city: p.get("city") || null,
    }),
  );
}
