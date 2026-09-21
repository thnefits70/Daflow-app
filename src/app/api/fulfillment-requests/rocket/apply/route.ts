import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canSubmitFulfillmentRequest } from "@/lib/guards";
import { applyRocketImport } from "@/lib/rocketRequest";

const schema = z.object({
  totalRows: z.number().int().nonnegative(),
  rows: z.array(
    z.object({
      code: z.string().min(1),
      name: z.string().min(1),
      quantity: z.number().int().positive(),
      targetType: z.enum(["product", "combo"]),
      targetId: z.string().min(1),
      createMapping: z.boolean(),
    })
  ),
  skippedCount: z.number().int().nonnegative(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!(await canSubmitFulfillmentRequest()) || !session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  if (parsed.data.rows.length === 0) return NextResponse.json({ error: "No hay ninguna fila lista para aplicar." }, { status: 400 });

  const result = await applyRocketImport(parsed.data, session.user.id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json(result);
}
