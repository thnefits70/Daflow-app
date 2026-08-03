import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canSubmitPurchaseRequests } from "@/lib/guards";

const schema = z.object({ carrierBankAccountId: z.string().min(1) });

// Confirmado 2026-08-03: algunos transportistas solo dan sus datos bancarios
// al entregar la mercadería — se puede elegir o cambiar la cuenta del
// transportista en cualquier momento, no solo al solicitar la compra.
export async function POST(req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  if (!(await canSubmitPurchaseRequests())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { groupId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const count = await prisma.purchaseRequest.count({ where: { groupId } });
  if (count === 0) return NextResponse.json({ error: "No encontrada." }, { status: 404 });

  await prisma.purchaseRequest.updateMany({
    where: { groupId },
    data: { carrierBankAccountId: parsed.data.carrierBankAccountId },
  });

  const updated = await prisma.purchaseRequest.findMany({ where: { groupId } });
  return NextResponse.json(updated);
}
