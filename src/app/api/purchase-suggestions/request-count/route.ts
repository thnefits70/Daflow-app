import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canSubmitPurchaseRequests } from "@/lib/guards";
import { requestProductCount } from "@/lib/purchaseSuggestions";

const schema = z.object({ catalogItemId: z.string().min(1) });

// Pedido del usuario 2026-10-13: lo que no se contó no se puede comprar.
// "Pedir que lo cuenten" le avisa al líder de Inventario (Daniel).
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  if (session.user.role !== "admin" && !(await canSubmitPurchaseRequests())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  const result = await requestProductCount(parsed.data.catalogItemId, session.user.name ?? "Alguien");
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
