import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canSubmitFulfillmentRequest } from "@/lib/guards";

const schema = z.object({
  totalRows: z.number().int().nonnegative(),
  rows: z.array(
    z.object({
      catalogItemId: z.string().min(1),
      quantity: z.number().int().positive(),
      sourceCode: z.string().nullable(),
      fromComboCode: z.string().nullable(),
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

  const batch = await prisma.fulfillmentRequestBatch.create({
    data: {
      source: "DROPI",
      requestedById: session.user.id,
      totalRows: parsed.data.totalRows,
      skippedCount: parsed.data.skippedCount,
      items: {
        create: parsed.data.rows.map((r) => ({
          catalogItemId: r.catalogItemId,
          quantity: r.quantity,
          sourceCode: r.sourceCode ?? "",
          fromComboCode: r.fromComboCode,
        })),
      },
    },
  });

  return NextResponse.json({ ok: true, batchId: batch.id });
}
