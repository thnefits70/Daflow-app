import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canSubmitPurchaseRequests } from "@/lib/guards";
import { readPurchaseQuote } from "@/lib/purchaseAi";
import { pushOwnerId } from "@/lib/pushOwner";

const schema = z.object({ quoteImageUrl: z.string().url(), expectedTotal: z.number().positive() });

// Sin escritura en la base de datos — confirmado 2026-07-30: "una sola vez
// por solicitud" se cumple aquí (la IA lee la imagen UNA vez); el POST que
// de verdad crea la solicitud reutiliza este resultado en vez de volver a
// llamar a la IA.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!(await canSubmitPurchaseRequests()) || !session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  try {
    const read = await readPurchaseQuote({
      quoteImageUrl: parsed.data.quoteImageUrl,
      actorId: pushOwnerId(session),
      deptId: session.user.deptId ?? undefined,
    });
    const matches = read.readTotal !== null && Math.abs(read.readTotal - parsed.data.expectedTotal) < 0.01;

    // Confirmado 2026-07-31: si la cotización solo trae un código, y ya
    // guardamos ESE código en un insumo del catálogo, lo sugerimos en vez de
    // obligar a buscar/confirmar desde cero cada vez.
    let suggestedCatalogItem: { id: string; name: string } | null = null;
    if (read.referenceCodeFound) {
      suggestedCatalogItem = await prisma.purchaseCatalogItem.findFirst({
        where: { code: { equals: read.referenceCodeFound, mode: "insensitive" } },
        select: { id: true, name: true },
      });
    }

    return NextResponse.json({ ...read, matches, suggestedCatalogItem });
  } catch (err) {
    const message = err instanceof Error ? err.message : "No se pudo leer la cotización.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
