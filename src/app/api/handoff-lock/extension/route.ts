import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canPublishMarketProduct } from "@/lib/guards";
import { requestIdExtension } from "@/lib/handoffLocks";

const schema = z.object({ proposalId: z.string().min(1), reason: z.string(), photoUrl: z.string() });

// Pedido del usuario 2026-10-15: la asesora B2B pulsa «Dropi no funciona»
// (con captura) y pide más tiempo para el ID madre — ver handoffLocks.ts.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session || !(await canPublishMarketProduct())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  const r = await requestIdExtension({ ...parsed.data, userId: session.user.id });
  return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.error }, { status: 409 });
}
