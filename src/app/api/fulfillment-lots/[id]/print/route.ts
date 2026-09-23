import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { canPrintFulfillmentManifest, dbUserId } from "@/lib/guards";
import { markLotPrinted } from "@/lib/fulfillmentGuides";

// Daniel imprime el corte: la primera vez le asigna su número de
// Manifiesto DAFLOW (MF-0001…); reimprimir mantiene el mismo número.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canPrintFulfillmentManifest()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const { id } = await params;
  const result = await markLotPrinted(id, dbUserId(session.user.id));
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, manifestNumber: result.manifestNumber });
}
