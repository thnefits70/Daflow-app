import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canSubmitPurchaseRequests } from "@/lib/guards";
import { readPurchaseOrder } from "@/lib/purchaseAi";
import { pushOwnerId } from "@/lib/pushOwner";

const schema = z.object({ purchaseOrderUrl: z.string().url(), expectedTotal: z.number().positive() });

// Mismo patrón que verify-quote — sin escritura en la base de datos, la IA
// lee la orden de compra UNA vez y el resultado se reutiliza al crear la
// solicitud, nunca se vuelve a llamar.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!(await canSubmitPurchaseRequests()) || !session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  try {
    const read = await readPurchaseOrder({
      purchaseOrderUrl: parsed.data.purchaseOrderUrl,
      actorId: pushOwnerId(session),
      deptId: session.user.deptId ?? undefined,
    });
    const matches = read.readTotal !== null && Math.abs(read.readTotal - parsed.data.expectedTotal) < 0.01;
    return NextResponse.json({ ...read, matches });
  } catch (err) {
    const message = err instanceof Error ? err.message : "No se pudo leer la orden de compra.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
