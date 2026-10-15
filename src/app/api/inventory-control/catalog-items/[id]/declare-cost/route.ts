import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminSession } from "@/lib/guards";
import { UnusualCostError, declareManualCost } from "@/lib/stockKardex";

const schema = z.object({ declaredCost: z.number().positive(), confirmUnusual: z.boolean().optional() });

// Confirmado 2026-09-21, pedido explícito del usuario (admin): desbloqueo
// rápido para un producto que ya tiene movimiento en INVESTOCK pero cuyo
// costo promedio sigue en $0 porque nunca se le cargó la compra real —
// exclusivo del admin, a propósito (es una decisión financiera, no un
// dato operativo del día a día como el resto de "Base de datos de
// productos"). Ver declareManualCost en stockKardex.ts para las reglas
// (desde 2026-10-15 también corrige un costo que nunca vino de una compra
// real; nunca reemplaza un costo real).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }

  try {
    const result = await declareManualCost({
      catalogItemId: id,
      declaredCost: parsed.data.declaredCost,
      declaredById: session.user.role === "admin" ? null : session.user.id,
      confirmUnusual: parsed.data.confirmUnusual,
    });
    return NextResponse.json(result);
  } catch (err) {
    // 2026-10-15: costo muy distinto a la última compra — el panel pregunta
    // y, si el admin confirma, vuelve a mandar con confirmUnusual.
    if (err instanceof UnusualCostError) {
      return NextResponse.json({ error: err.message, needsConfirm: true }, { status: 409 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : "No se pudo declarar el costo." }, { status: 409 });
  }
}
