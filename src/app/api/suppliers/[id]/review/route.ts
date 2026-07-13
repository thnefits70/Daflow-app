import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canReviewSupplier } from "@/lib/guards";

const reviewSchema = z.object({
  action: z.enum(["approve", "reject"]),
  rejectReason: z.string().trim().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const { id } = await params;

  const existing = await prisma.supplier.findUnique({ where: { id }, select: { status: true, createdByDeptId: true } });
  if (!existing) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (existing.status !== "PENDING") {
    return NextResponse.json({ error: "Esta propuesta ya fue revisada." }, { status: 409 });
  }
  if (!(await canReviewSupplier(existing.createdByDeptId))) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = reviewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }

  // Admin's session id ("admin") isn't a real User row, so only an
  // employee-leader's approval gets attributed to a linked user.
  const approvedById = session.user.role === "admin" ? null : session.user.id;

  const supplier = await prisma.supplier.update({
    where: { id },
    data:
      parsed.data.action === "approve"
        ? { status: "APPROVED", approvedById, approvedAt: new Date(), rejectReason: null }
        : { status: "REJECTED", approvedById, approvedAt: new Date(), rejectReason: parsed.data.rejectReason || null },
    include: { contacts: true, createdBy: { select: { name: true } }, approvedBy: { select: { name: true } } },
  });
  return NextResponse.json(supplier);
}
