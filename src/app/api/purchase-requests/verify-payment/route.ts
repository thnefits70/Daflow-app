import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canRegisterPurchaseInvoices } from "@/lib/guards";
import { readPaymentProof } from "@/lib/purchaseAi";
import { pushOwnerId } from "@/lib/pushOwner";

const schema = z.object({ proofUrl: z.string().url(), expectedAmount: z.number().positive() });

// Confirmado 2026-08-04: antes de dar por pagada una compra (o un flete), la
// IA lee el comprobante y se compara contra lo que de verdad correspondía —
// un sobrepago o un monto que no cuadra no debe pasar desapercibido. Sin
// escritura en la base de datos, igual que verify-quote.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!(await canRegisterPurchaseInvoices()) || !session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  try {
    const read = await readPaymentProof({
      proofImageUrl: parsed.data.proofUrl,
      actorId: pushOwnerId(session),
      deptId: session.user.deptId ?? undefined,
    });
    const matches = read.readAmount !== null && Math.abs(read.readAmount - parsed.data.expectedAmount) < 0.01;
    return NextResponse.json({ ...read, matches });
  } catch (err) {
    const message = err instanceof Error ? err.message : "No se pudo leer el comprobante.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
