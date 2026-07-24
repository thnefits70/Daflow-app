import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canManagePurchaseReceipts } from "@/lib/guards";

const createSchema = z.object({
  deptId: z.string().min(1),
  proveedor: z.string().trim().min(1, "Ingresa el nombre del proveedor."),
  monto: z.number().positive("Ingresa un monto válido."),
  fechaPago: z.string().min(1, "Ingresa la fecha de pago."),
  fileUrl: z.string().min(1, "Sube el comprobante."),
  fileName: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }
  const { deptId, ...data } = parsed.data;

  if (!(await canManagePurchaseReceipts(deptId))) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const session = await auth();
  const createdById = session?.user.role === "admin" ? null : (session?.user.id ?? null);

  const receipt = await prisma.purchaseReceipt.create({
    data: {
      deptId,
      proveedor: data.proveedor,
      monto: data.monto,
      fechaPago: new Date(data.fechaPago),
      fileUrl: data.fileUrl,
      fileName: data.fileName,
      createdById,
    },
  });

  return NextResponse.json(receipt, { status: 201 });
}
