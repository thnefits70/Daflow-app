import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canConfirmFulfillmentLot, dbUserId } from "@/lib/guards";
import { confirmPicks } from "@/lib/fulfillmentPicking";

const schema = z.object({ catalogItemIds: z.array(z.string().min(1)).min(1).max(1000), onlyMatching: z.boolean() });

// Daniel confirma lo que salió (la doble confirmación es en pantalla) — acá
// se descuenta del Kardex de INVESTOCK.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canConfirmFulfillmentLot()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  const { id } = await params;
  const result = await confirmPicks({ lotId: id, catalogItemIds: parsed.data.catalogItemIds, onlyMatching: parsed.data.onlyMatching, userId: dbUserId(session.user.id) });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, confirmed: result.confirmed });
}
