import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canManageInventoryControl } from "@/lib/guards";
import { getFinanzasDeptId, recentInventoryPeriods } from "@/lib/inventoryKpis";
import { readInventoryValueProof } from "@/lib/inventoryAi";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/),
  value: z.number().nonnegative(),
  proofUrl: z.string().url().nullable().optional(),
});

// Daniel (líder de Inventario) carga el único dato mensual que le
// corresponde — confirmado 2026-08-04: escribe directo en el mismo
// FinanceSharedMonthlyBalance.inventarioFinal que ya usa "Cargar plantilla",
// solo que desde su propia pantalla ("Control de Inventario" en Mi área de
// trabajo) en vez de la de Finanzas. Confirmado 2026-08-05: puede elegir
// CUALQUIER mes reciente (no solo el actual, ej. cargar julio atrasado).
// Corregido 2026-08-31: este endpoint YA NO confía en el aiReadAmount/
// aiMatches que mandaba el cliente (el chequeo de /verify-value-proof era
// solo de la pantalla — nada impedía llamar a este endpoint directo, sin
// pasar por ahí, y guardar cualquier monto con "coincide" a la fuerza). Ahora
// vuelve a leer la captura con IA aquí mismo y decide el match él solo,
// mismo patrón que /api/petty-cash/entries.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!(await canManageInventoryControl()) || !session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  if (!recentInventoryPeriods().includes(parsed.data.period)) {
    return NextResponse.json({ error: "Ese mes no está disponible para cargar." }, { status: 400 });
  }

  const deptId = await getFinanzasDeptId();
  if (!deptId) return NextResponse.json({ error: "No se encontró el departamento de Finanzas." }, { status: 500 });

  const { period, value, proofUrl } = parsed.data;

  let aiReadAmount: number | null = null;
  let aiMatches: boolean | null = null;
  if (proofUrl) {
    try {
      const read = await readInventoryValueProof({ proofUrl, actorId: session.user.id, deptId: session.user.deptId ?? undefined });
      aiReadAmount = read.readAmount;
      aiMatches = read.readAmount !== null && Math.abs(read.readAmount - value) < 0.01;
    } catch {
      // La IA no pudo leer el comprobante — se guarda igual, solo sin verificación.
    }
  }

  // Mismo freno que en petty-cash/entries: un mismatch CONFIRMADO (o una
  // captura que la IA sí procesó pero no pudo leer con claridad) bloquea el
  // guardado — solo una falla real de la IA (excepción/red) deja pasar sin
  // verificar.
  if (aiMatches === false) {
    return NextResponse.json(
      { error: `Rechazado — la captura muestra ${aiReadAmount !== null ? `$${aiReadAmount.toFixed(2)}` : "un monto que no se pudo leer con claridad"}, pero ingresaste $${value.toFixed(2)}.` },
      { status: 409 }
    );
  }

  const data = {
    inventarioFinal: value,
    inventarioProofUrl: proofUrl || null,
    inventarioAiReadAmount: aiReadAmount,
    inventarioAiMatches: aiMatches,
  };
  await prisma.financeSharedMonthlyBalance.upsert({
    where: { deptId_period: { deptId, period } },
    create: { deptId, period, ...data },
    update: data,
  });

  return NextResponse.json({ ok: true, period });
}
