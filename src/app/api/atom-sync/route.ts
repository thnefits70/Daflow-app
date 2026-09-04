import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canSyncAtomData, dbUserId } from "@/lib/guards";
import { applyAtomSync } from "@/lib/atomSync";

// Confirmado 2026-09-03: guardar dispara generateComboSuggestions, que corre
// varias llamadas de IA en paralelo y puede tardar más que el límite por
// defecto de una función serverless.
export const maxDuration = 60;

const schema = z.object({
  rows: z.array(
    z.object({
      productName: z.string().trim().min(1),
      confirmedMatchedItemId: z.string().nullable(),
      isCombo: z.boolean(),
    })
  ),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session || !(await canSyncAtomData())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  if (parsed.data.rows.length === 0) return NextResponse.json({ error: "No hay filas para registrar." }, { status: 400 });

  const capturedAt = new Date();
  const result = await applyAtomSync(parsed.data.rows, capturedAt, dbUserId(session.user.id), session.user.name ?? null, session.user.id);
  return NextResponse.json({ ok: true, ...result, capturedAt });
}
