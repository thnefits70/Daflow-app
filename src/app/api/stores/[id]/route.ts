import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canManageStoreFeedback } from "@/lib/guards";

const updateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  contactName: z.string().trim().optional().nullable(),
  contactPhone: z.string().trim().optional().nullable(),
  isActive: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canManageStoreFeedback())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }
  const data = parsed.data;

  const updated = await prisma.store.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.contactName !== undefined ? { contactName: data.contactName || null } : {}),
      ...(data.contactPhone !== undefined ? { contactPhone: data.contactPhone || null } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
    },
  });

  return NextResponse.json(updated);
}

// Permanent delete only allowed with zero evaluation history — same rule as
// stockout products / warranty categories elsewhere in this app.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canManageStoreFeedback())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const evaluationCount = await prisma.storeFeedbackEvaluation.count({ where: { storeId: id } });
  if (evaluationCount > 0) {
    return NextResponse.json(
      { error: "No se puede eliminar: esta tienda ya tiene evaluaciones registradas." },
      { status: 400 }
    );
  }

  await prisma.store.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
