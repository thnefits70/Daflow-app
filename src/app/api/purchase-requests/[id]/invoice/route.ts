import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canRegisterPurchaseInvoices } from "@/lib/guards";

const schema = z.object({
  invoiceStatus: z.enum(["PENDING", "COMPLETE", "PARTIAL", "NON_FISCAL", "NONE"]),
  invoiceAmount: z.number().positive().nullable().optional(),
  invoiceDocUrl: z.string().url().nullable().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canRegisterPurchaseInvoices())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  if (parsed.data.invoiceStatus === "PARTIAL" && !parsed.data.invoiceAmount) {
    return NextResponse.json({ error: "Falta el valor por el que se facturó." }, { status: 400 });
  }

  const existing = await prisma.purchaseRequest.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "No encontrada." }, { status: 404 });

  const updated = await prisma.purchaseRequest.update({
    where: { id },
    data: {
      invoiceStatus: parsed.data.invoiceStatus,
      invoiceAmount: parsed.data.invoiceStatus === "PARTIAL" ? parsed.data.invoiceAmount : null,
      invoiceDocUrl: parsed.data.invoiceDocUrl || null,
    },
  });
  return NextResponse.json(updated);
}
