import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canSubmitPurchaseRequests } from "@/lib/guards";

const schema = z.object({ purchaseOrderUrl: z.string().url() });

// Confirmado 2026-07-31: quien solicita la compra normalmente no tiene la
// orden de compra lista el mismo día — se puede adjuntar después, en
// cualquier estado del grupo, sin tener que volver a hacer la solicitud.
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
    data: { purchaseOrderUrl: parsed.data.purchaseOrderUrl },
  });

  const updated = await prisma.purchaseRequest.findMany({ where: { groupId } });
  return NextResponse.json(updated);
}
