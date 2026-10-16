import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canRetainCancelledGuides, dbUserId } from "@/lib/guards";
import { releaseGuide, retainGuide, undoRetain } from "@/lib/fulfillmentGuideHolds";

const schema = z.object({ action: z.enum(["retain", "release", "undo"]), guideNumber: z.string().min(3).max(60), catalogItemId: z.string().min(1).optional() });

// Guías retenidas por falta de stock (2026-10-16): Daniel o Allan confirman
// que la retuvieron y, cuando la recogen, que ya salió.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || !(await canRetainCancelledGuides())) return NextResponse.json({ error: "Solo Daniel o Allan marcan las guías retenidas." }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  const { id } = await params;
  const userId = dbUserId(session.user.id);
  const { action, guideNumber, catalogItemId } = parsed.data;
  const r =
    action === "retain" ? (catalogItemId ? await retainGuide({ lotId: id, catalogItemId, guideNumber, userId }) : { ok: false as const, error: "Falta el producto." })
    : action === "release" ? await releaseGuide(guideNumber, userId)
    : await undoRetain(guideNumber);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });
  return NextResponse.json({ ok: true });
}
