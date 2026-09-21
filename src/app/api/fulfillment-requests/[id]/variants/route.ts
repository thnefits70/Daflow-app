import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canSubmitFulfillmentRequest } from "@/lib/guards";
import { saveVariantNotes } from "@/lib/rocketRequest";

const schema = z.object({
  catalogItemId: z.string().min(1),
  variants: z.array(z.object({ label: z.string().min(1), quantity: z.number().int().positive() })),
});

// Confirmado 2026-09-21: solo quien puede subir la solicitud (Yair/FUL)
// puede escribir el desglose de variantes — Daniel/admin lo ven, no lo editan.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canSubmitFulfillmentRequest()) || !session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const result = await saveVariantNotes(id, parsed.data.catalogItemId, parsed.data.variants, session.user.id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, variants: result.variants });
}
