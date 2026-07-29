import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canSubmitPurchaseRequests } from "@/lib/guards";
import { checkCatalogNameSimilarity } from "@/lib/purchaseAi";
import { pushOwnerId } from "@/lib/pushOwner";

const schema = z.object({ name: z.string().trim().min(1) });

// Confirmado 2026-07-30: solo avisa, nunca bloquea — la persona decide si de
// verdad es un producto distinto. El match EXACTO (bloqueante) se resuelve
// aparte, directo en el POST de creación.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!(await canSubmitPurchaseRequests()) || !session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const exactMatch = await prisma.purchaseCatalogItem.findFirst({
    where: { name: { equals: parsed.data.name, mode: "insensitive" } },
    select: { id: true, name: true },
  });
  if (exactMatch) return NextResponse.json({ exactMatch, similarity: null });

  const similarity = await checkCatalogNameSimilarity({
    candidateName: parsed.data.name,
    actorId: pushOwnerId(session),
  }).catch(() => null);
  return NextResponse.json({ exactMatch: null, similarity });
}
