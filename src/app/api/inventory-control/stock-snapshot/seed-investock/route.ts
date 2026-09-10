import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { canManageInventoryControl } from "@/lib/guards";
import { seedFromJustSnapshot } from "@/lib/stockKardex";

const schema = z.object({
  rows: z.array(z.object({ productCode: z.string().trim().min(1), avgCost: z.number(), stock: z.number() })).min(1),
});

// Confirmado 2026-09-10 (pedido explícito del usuario): "cargar saldo
// inicial de INVESTOCK" — le da a cada producto que todavía esté en 0 el
// stock/costo promedio real que trae el export de Just, para que no arranque
// de cero. Solo toca productos SIN ningún movimiento propio todavía (ver
// seedFromJustSnapshot) — seguro de llamar más de una vez, nunca pisa un
// número que ya está corriendo de verdad.
export async function POST(req: NextRequest) {
  if (!(await canManageInventoryControl())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const result = await seedFromJustSnapshot(parsed.data.rows);
  return NextResponse.json(result);
}
