import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminSession } from "@/lib/guards";
import { reviewPhysicalCountAdjustment } from "@/lib/stockKardex";

const schema = z.object({ action: z.enum(["approve", "reject"]) });

// Confirmado 2026-09-22, pedido explícito del usuario (admin): solo el
// admin aprueba o rechaza una solicitud de ajuste de stock de Daniel —
// mismo patrón que la aprobación de solicitudes de borrado de catálogo.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  try {
    const result = await reviewPhysicalCountAdjustment({ id, action: parsed.data.action });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "No se pudo procesar la solicitud." }, { status: 409 });
  }
}
