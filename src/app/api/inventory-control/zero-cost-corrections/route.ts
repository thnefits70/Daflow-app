import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminSession } from "@/lib/guards";
import { getZeroCostCorrections } from "@/lib/sellingCost";
import { applyZeroCostCorrections } from "@/lib/stockKardex";

// Pedido del usuario (CEO) 2026-10-02: corregir el costo del Kardex de los
// productos donde unidades que entraron a $0 bajaron el promedio. Solo admin
// (decisión financiera). Ver applyZeroCostCorrections en stockKardex.ts.
export async function GET() {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  return NextResponse.json(await getZeroCostCorrections());
}

const schema = z.object({
  rows: z.array(z.object({ catalogItemId: z.string().min(1), balance: z.number().int(), kardexAvg: z.number() })).min(1),
});

export async function POST(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  const result = await applyZeroCostCorrections(parsed.data.rows, session.user.role === "admin" ? null : session.user.id);
  return NextResponse.json(result);
}
