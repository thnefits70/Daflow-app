import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canDeclareExternalSales } from "@/lib/guards";
import { notifyAdminPaymentProofUploaded } from "@/lib/externalSales";

const schema = z.object({ proofUrl: z.string().url(), proofName: z.string().trim().optional() });

// El asesor sube el comprobante — puede pasar en cualquier momento después
// de la aprobación de Bryan (antes o después del despacho, según sea
// prepago o contra-entrega como Marcos).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canDeclareExternalSales()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const sale = await prisma.externalSale.findUnique({ where: { id }, select: { advisorId: true, reviewStatus: true, code: true } });
  if (!sale) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (sale.advisorId !== session.user.id && session.user.role !== "admin") return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  if (sale.reviewStatus !== "APPROVED") return NextResponse.json({ error: "Esta venta todavía no está aprobada." }, { status: 409 });

  const updated = await prisma.externalSale.update({
    where: { id },
    data: { paymentProofUrl: parsed.data.proofUrl, paymentProofName: parsed.data.proofName || null, paymentProofUploadedAt: new Date() },
  });

  await notifyAdminPaymentProofUploaded(sale.code);
  return NextResponse.json(updated);
}
