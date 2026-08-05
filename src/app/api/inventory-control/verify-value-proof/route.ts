import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canManageInventoryControl } from "@/lib/guards";
import { readInventoryValueProof } from "@/lib/inventoryAi";

const schema = z.object({ proofUrl: z.string().url(), expectedValue: z.number().nonnegative() });

// Sin escritura en la base de datos — mismo patrón que verify-quote de
// Control de Compras: la IA lee la captura UNA vez aquí; el POST que de
// verdad guarda el mes reutiliza este resultado en vez de volver a llamarla.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!(await canManageInventoryControl()) || !session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  try {
    const read = await readInventoryValueProof({
      proofUrl: parsed.data.proofUrl,
      actorId: session.user.id,
      deptId: session.user.deptId ?? undefined,
    });
    const matches = read.readAmount !== null && Math.abs(read.readAmount - parsed.data.expectedValue) < 0.01;
    return NextResponse.json({ ...read, matches });
  } catch (err) {
    const message = err instanceof Error ? err.message : "No se pudo leer la captura.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
