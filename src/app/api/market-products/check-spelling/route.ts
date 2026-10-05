import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canProposeMarketProduct } from "@/lib/guards";
import { checkNameSpelling } from "@/lib/purchaseAi";
import { pushOwnerId } from "@/lib/pushOwner";

const schema = z.object({ name: z.string().trim().min(1).max(200) });

// Sugerencia de ortografía del nombre comercial antes de proponer
// (2026-10-05). Si la IA falla, no frena nada: responde sin sugerencia.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!(await canProposeMarketProduct()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  const spellingFix = await checkNameSpelling({ name: parsed.data.name, actorId: pushOwnerId(session) }).catch(() => null);
  return NextResponse.json({ spellingFix });
}
