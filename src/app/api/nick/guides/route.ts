import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { canAccessNick } from "@/lib/guards";
import { getNickGuides } from "@/lib/nick/guides";
import type { NickGroup } from "@/lib/nick/sync";
import { NICK_ATTENTION, type NickAttentionKey } from "@/lib/nick/attention";

const GROUPS = new Set(["PREPARANDO", "EN_CAMINO", "NOVEDAD", "ENTREGADA", "DEVOLUCION", "CANCELADA", "NO_ENCONTRADA"]);

export async function GET(req: NextRequest) {
  if (!(await canAccessNick())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const session = await auth();
  const p = req.nextUrl.searchParams;
  const group = p.get("group");
  const day = p.get("day");
  const attention = p.get("attention");
  return NextResponse.json(
    await getNickGuides({
      group: group && GROUPS.has(group) ? (group as NickGroup | "NO_ENCONTRADA") : null,
      attention: NICK_ATTENTION.some((a) => a.key === attention) ? (attention as NickAttentionKey) : null,
      account: p.get("account") || null,
      carrier: p.get("carrier") || null,
      day: day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null,
      q: p.get("q") || null,
      page: Number(p.get("page")) || 1,
    }, { isAdmin: session?.user.role === "admin" }),
  );
}
