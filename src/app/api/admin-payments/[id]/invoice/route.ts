import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canManageAdminPayments } from "@/lib/guards";

const schema = z.object({ fileUrl: z.string().url(), fileName: z.string().nullable().optional() });

// Pedido de Nairoby 2026-10-13: algunos proveedores entregan la factura
// después del pago. Solo se guarda (sin IA, no bloquea nada) y se puede
// reemplazar si se subió mal; queda quién y cuándo.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || !(await canManageAdminPayments())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const request = await prisma.adminPaymentRequest.findUnique({ where: { id }, select: { id: true } });
  if (!request) return NextResponse.json({ error: "No encontrada." }, { status: 404 });

  const updated = await prisma.adminPaymentRequest.update({
    where: { id },
    data: {
      invoiceFileUrl: parsed.data.fileUrl,
      invoiceFileName: parsed.data.fileName ?? null,
      invoiceUploadedAt: new Date(),
      invoiceUploadedById: session.user.role === "admin" ? null : session.user.id,
    },
  });
  return NextResponse.json(updated);
}
