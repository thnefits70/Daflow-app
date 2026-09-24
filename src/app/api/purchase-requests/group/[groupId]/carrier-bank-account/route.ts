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

  const existing = await prisma.purchaseRequest.findFirst({ where: { groupId }, select: { carrierId: true, shippingPaidAt: true } });
  if (!existing) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  // Confirmado 2026-09-23, revisión anti-fraude: la cuenta tiene que ser del
  // transportista de esta solicitud, y una vez pagado el flete ya no se cambia.
  const account = await prisma.supplierBankAccount.findUnique({ where: { id: parsed.data.carrierBankAccountId }, select: { supplierId: true } });
  if (!account || !existing.carrierId || account.supplierId !== existing.carrierId) {
    return NextResponse.json({ error: "Esa cuenta no es del transportista de esta solicitud." }, { status: 400 });
  }
  if (existing.shippingPaidAt) return NextResponse.json({ error: "El flete ya se pagó — la cuenta ya no se puede cambiar." }, { status: 409 });

  await prisma.purchaseRequest.updateMany({
    where: { groupId },
    data: { carrierBankAccountId: parsed.data.carrierBankAccountId },
  });

  const updated = await prisma.purchaseRequest.findMany({ where: { groupId } });
  return NextResponse.json(updated);
}
