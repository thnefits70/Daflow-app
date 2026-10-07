import { NextResponse } from "next/server";
import { getRepurchaseAccess } from "@/lib/repurchaseAccess";
import { cancelRepurchaseReview } from "@/lib/repurchaseReviews";

// Quien la envió la retira mientras sigue esperando a Bryan.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await getRepurchaseAccess();
  if (!access?.canRequest) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const { id } = await params;
  const result = await cancelRepurchaseReview(id, access.userId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
