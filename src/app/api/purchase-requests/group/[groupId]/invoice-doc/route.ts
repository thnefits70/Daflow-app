import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canRegisterPurchaseInvoices } from "@/lib/guards";

const schema = z.object({
  invoiceDocUrl: z.string().url(),
});

// Reemplaza SOLO el documento de una factura ya registrada (invoiceStatus,
// invoiceAmount, invoicedBy e invoicedAt no cambian) — para corregir un
// archivo mal subido sin tocar el resto del registro ni el tiempo de cierre
// que alimenta Auditoría.
export async function POST(req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const session = await auth();
  if (!(await canRegisterPurchaseInvoices()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { groupId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const existing = await prisma.purchaseRequest.findFirst({ where: { groupId } });
  if (!existing) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (existing.invoiceStatus === "PENDING") return NextResponse.json({ error: "Esta operación todavía no tiene factura registrada." }, { status: 400 });

  await prisma.purchaseRequest.updateMany({
    where: { groupId },
    data: { invoiceDocUrl: parsed.data.invoiceDocUrl },
  });
  const updated = await prisma.purchaseRequest.findMany({ where: { groupId } });
  return NextResponse.json(updated);
}
