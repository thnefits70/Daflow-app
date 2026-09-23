import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canSubmitFulfillmentRequest, dbUserId } from "@/lib/guards";
import { applyGuidesImport } from "@/lib/fulfillmentGuides";

const variantSchema = z.object({ label: z.string().trim().min(1).max(120), quantity: z.number().int().positive() });
const schema = z.object({
  fileUrls: z.array(z.string().url()).min(1).max(10),
  manifestDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  guides: z.array(z.object({ number: z.string().trim().min(1).max(40), carrier: z.string().max(40) })).max(3000),
  rows: z
    .array(
      z.object({
        code: z.string().trim().min(1).max(30),
        name: z.string().max(200),
        quantity: z.number().int().positive(),
        labelUnits: z.number().int().nonnegative(),
        variants: z.array(variantSchema).max(50),
        decision: z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("product"), catalogItemId: z.string().min(1) }),
          z.object({ kind: z.literal("combo") }),
          z.object({ kind: z.literal("ignore") }),
        ]),
      })
    )
    .min(1)
    .max(1000),
});

// Guarda la lectura del PDF de guías ya revisada por Yair — y lo que la app
// "aprende" en el camino (ID de Dropi puesto a un producto que no lo tenía,
// códigos marcados como "no es producto"). Ver src/lib/fulfillmentGuides.ts.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!(await canSubmitFulfillmentRequest()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const result = await applyGuidesImport(parsed.data, dbUserId(session.user.id));
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, batchId: result.batchId });
}
