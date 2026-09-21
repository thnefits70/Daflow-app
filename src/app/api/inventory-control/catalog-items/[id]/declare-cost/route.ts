import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminSession } from "@/lib/guards";
import { declareManualCost } from "@/lib/stockKardex";

const schema = z.object({ declaredCost: z.number().positive() });

// Confirmado 2026-09-21, pedido explícito del usuario (admin): desbloqueo
// rápido para un producto que ya tiene movimiento en INVESTOCK pero cuyo
// costo promedio sigue en $0 porque nunca se le cargó la compra real —
// exclusivo del admin, a propósito (es una decisión financiera, no un
// dato operativo del día a día como el resto de "Base de datos de
// productos"). Ver declareManualCost en stockKardex.ts para las reglas
// (solo mientras el costo siga en $0, nunca reemplaza un costo real).
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
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "No se pudo declarar el costo." }, { status: 409 });
  }
}
