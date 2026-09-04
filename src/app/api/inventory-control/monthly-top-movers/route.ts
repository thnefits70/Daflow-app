import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canManageInventoryControl, dbUserId } from "@/lib/guards";

const MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

const schema = z.object({
  month: z.string().regex(MONTH_REGEX),
  rows: z.array(z.object({ catalogItemId: z.string().min(1), unitsMoved: z.number().int().nonnegative() })),
});

// Confirmado 2026-09-04: subir un mes que ya tenía datos los REEMPLAZA por
// completo (borra y vuelve a crear) — mismo criterio que el resto de
// reportes mensuales/semanales de esta app ("si detectaste un error, sube
// de nuevo"), nunca acumula filas viejas y nuevas mezcladas.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session || !(await canManageInventoryControl())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  if (parsed.data.rows.length === 0) return NextResponse.json({ error: "No hay productos para registrar." }, { status: 400 });

  const { month, rows } = parsed.data;
  const createdById = dbUserId(session.user.id);
  const createdByName = session.user.name ?? null;

  await prisma.$transaction([
    prisma.monthlyTopMoverEntry.deleteMany({ where: { month } }),
    prisma.monthlyTopMoverEntry.createMany({
      data: rows.map((r) => ({ month, catalogItemId: r.catalogItemId, unitsMoved: r.unitsMoved, createdById, createdByName })),
    }),
  ]);

  return NextResponse.json({ ok: true, savedCount: rows.length });
}

export async function GET(req: NextRequest) {
  if (!(await canManageInventoryControl())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const month = req.nextUrl.searchParams.get("month");
  const entries = await prisma.monthlyTopMoverEntry.findMany({
    where: month ? { month } : undefined,
    orderBy: [{ month: "desc" }, { unitsMoved: "desc" }],
    include: { catalogItem: { select: { id: true, name: true, justCode: true } } },
  });
  return NextResponse.json({ entries });
}
