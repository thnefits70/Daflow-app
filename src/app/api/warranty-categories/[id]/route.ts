import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canManageWarranties } from "@/lib/guards";

// Permanently removes a catalog entry — but only if it has zero history.
// The relation is onDelete: Cascade at the DB level, so this check (not the
// FK) is what actually prevents silently wiping real month counts.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const canManage = await canManageWarranties();
  if (!canManage) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const usageCount = await prisma.warrantyCategoryMonthCount.count({ where: { categoryId: id } });
  if (usageCount > 0) {
    return NextResponse.json(
      { error: "No se puede eliminar: tiene historial guardado en meses. Borra ese historial primero." },
      { status: 409 }
    );
  }

  await prisma.warrantyCategory.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
