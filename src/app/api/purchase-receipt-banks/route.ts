import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canManagePurchaseReceipts } from "@/lib/guards";

const createSchema = z.object({
  deptId: z.string().min(1),
  name: z.string().trim().min(1, "Falta el nombre del banco."),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }
  const { deptId, name } = parsed.data;
  if (!(await canManagePurchaseReceipts(deptId))) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const bank = await prisma.purchaseReceiptBank.create({ data: { deptId, name } }).catch(() => null);
  if (!bank) return NextResponse.json({ error: "Ya existe un banco con ese nombre." }, { status: 409 });

  return NextResponse.json(bank, { status: 201 });
}
