import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canSubmitPurchaseRequests } from "@/lib/guards";
import { readPurchaseQuote } from "@/lib/purchaseAi";
import { pushOwnerId } from "@/lib/pushOwner";

const schema = z.object({
  quoteImageUrl: z.string().url(),
  expectedTotal: z.number().positive(),
  // Confirmado 2026-09-09: nombres de producto que la persona ya
  // tipeó/eligió en el formulario, para dárselos a la IA como pista al leer
  // letra manuscrita (ver readPurchaseQuote en lib/purchaseAi.ts).
  expectedProductNames: z.array(z.string()).optional(),
});

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
      expectedProductNames: parsed.data.expectedProductNames,
    });
    const matches = read.readTotal !== null && Math.abs(read.readTotal - parsed.data.expectedTotal) < 0.01;

    // Confirmado 2026-09-21: ya no se pide una orden de compra de respaldo —
    // por cada línea que solo trae código (sin nombre), si ya guardamos ESE
    // código en un insumo del catálogo (porque alguien ya lo confirmó antes,
    // ver /api/purchase-requests/confirm-code), se sugiere solo, sin volver
    // a pedir confirmación. Antes esto solo se resolvía para UN código por
    // cotización entera; ahora es por cada línea detectada.
    const codes = [...new Set(read.lines.map((l) => l.referenceCodeFound).filter((c): c is string => !!c))];
    const found =
      codes.length > 0
        ? await prisma.purchaseCatalogItem.findMany({
            where: { code: { in: codes, mode: "insensitive" } },
            select: { id: true, name: true, code: true },
          })
        : [];
    const byCode = new Map(found.map((f) => [f.code!.trim().toLowerCase(), { id: f.id, name: f.name }]));
    const lines = read.lines.map((l) => ({
      ...l,
      suggestedCatalogItem: l.referenceCodeFound ? byCode.get(l.referenceCodeFound.trim().toLowerCase()) ?? null : null,
    }));

    return NextResponse.json({ readTotal: read.readTotal, matches, lines });
  } catch (err) {
    const message = err instanceof Error ? err.message : "No se pudo leer la cotización.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
