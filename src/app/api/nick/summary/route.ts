import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/guards";
import { getNickSummary } from "@/lib/nick/summary";

export const maxDuration = 60;

// Resumen de NICK: SOLO el admin (pedido del usuario 2026-10-17).
export async function GET(req: NextRequest) {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  return NextResponse.json(await getNickSummary({ days: Number(req.nextUrl.searchParams.get("days")) || 7 }));
}
