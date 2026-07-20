import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canManageStockouts } from "@/lib/guards";

const schema = z.object({
  week: z.string().regex(/^\d{4}-W\d{2}$/, "Semana inválida."),
});

// Explicit "reviewed this week, nothing to report" — see
// StockoutWeekConfirmation in schema.prisma for why this exists separately
// from just having zero StockoutWeekProduct rows.
export async function POST(req: NextRequest) {
  const canManage = await canManageStockouts();
  if (!canManage) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }

  const confirmation = await prisma.stockoutWeekConfirmation.upsert({
    where: { week: parsed.data.week },
    update: {},
    create: { week: parsed.data.week },
  });
  return NextResponse.json(confirmation, { status: 201 });
}
