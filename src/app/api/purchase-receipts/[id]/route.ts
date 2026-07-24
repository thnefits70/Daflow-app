import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/guards";

// Direct edit/delete is admin-only — the leader must go through
// POST .../request instead, which the admin then approves or rejects.
const updateSchema = z.object({
  proveedor: z.string().trim().min(1).optional(),
  monto: z.number().positive().optional(),
  fechaPago: z.string().min(1).optional(),
  fileUrl: z.string().min(1).optional(),
  fileName: z.string().min(1).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }
  const data = parsed.data;

  const updated = await prisma.purchaseReceipt.update({
    where: { id },
    data: {
      ...(data.proveedor !== undefined ? { proveedor: data.proveedor } : {}),
      ...(data.monto !== undefined ? { monto: data.monto } : {}),
      ...(data.fechaPago !== undefined ? { fechaPago: new Date(data.fechaPago) } : {}),
      ...(data.fileUrl !== undefined ? { fileUrl: data.fileUrl } : {}),
      ...(data.fileName !== undefined ? { fileName: data.fileName } : {}),
    },
  });

  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const { id } = await params;

  await prisma.purchaseReceipt.deleteMany({ where: { id } });
  return NextResponse.json({ ok: true });
}
