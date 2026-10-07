import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canAssignFulfillmentBlocks, dbUserId } from "@/lib/guards";
import { assignBlock } from "@/lib/fulfillmentPicking";

const schema = z.object({ carrier: z.string().min(1), assigneeId: z.string().min(1).nullable() });

// Daniel (o Allan, desde 2026-10-07) asigna un bloque del manifiesto a
// alguien del equipo.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canAssignFulfillmentBlocks()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  const { id } = await params;
  const result = await assignBlock({ lotId: id, carrier: parsed.data.carrier, assigneeId: parsed.data.assigneeId, userId: dbUserId(session.user.id) });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
