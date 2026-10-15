import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canActOnMarketProductReview } from "@/lib/guards";
import { getActiveDropiOutage, getPendingIdExtensions, setDropiOutage } from "@/lib/handoffLocks";

const schema = z.object({ down: z.boolean(), note: z.string().optional() });

// Pedido del usuario 2026-10-15: Bryan (líder de Análisis de Mercado) o el
// admin marcan «Dropi está caído» / «Dropi ya volvió» — ver handoffLocks.ts.
async function canToggle(): Promise<{ ok: boolean; isAdmin: boolean; userId: string | null }> {
  const session = await auth();
  if (!session) return { ok: false, isAdmin: false, userId: null };
  if (session.user.role === "admin") return { ok: true, isAdmin: true, userId: null };
  return { ok: await canActOnMarketProductReview(), isAdmin: false, userId: session.user.id };
}

export async function GET() {
  const who = await canToggle();
  if (!who.ok) return NextResponse.json({ canToggle: false, outage: null, extensions: [] });
  // Los pedidos de más tiempo de la asesora B2B solo los responde el admin.
  return NextResponse.json({ canToggle: true, isAdmin: who.isAdmin, outage: await getActiveDropiOutage(), extensions: who.isAdmin ? await getPendingIdExtensions() : [] });
}

export async function POST(req: NextRequest) {
  const who = await canToggle();
  if (!who.ok) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  const r = await setDropiOutage({ down: parsed.data.down, note: parsed.data.note, userId: who.userId });
  return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.error }, { status: 409 });
}
