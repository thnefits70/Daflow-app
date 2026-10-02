import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canActOnMerchandiseOutflow, dbUserId } from "@/lib/guards";
import { notifyOwner } from "@/lib/notifications";
import { submitCount } from "@/lib/stockCount";
import { prisma } from "@/lib/prisma";

// Daniel revisa y envía: las diferencias le llegan al admin en una lista.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || !(await canActOnMerchandiseOutflow())) return NextResponse.json({ error: "Solo el líder de Inventarios envía el conteo." }, { status: 403 });
  const { id } = await params;
  const r = await submitCount(id, dbUserId(session.user.id));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });
  if (r.differences > 0) {
    const inv = await prisma.department.findFirst({ where: { code: "INV" }, select: { id: true } });
    await notifyOwner("admin", {
      title: "📋 Conteo físico por aprobar",
      body: `Daniel envió el conteo: ${r.differences} producto(s) con diferencia. Revísalos en Stock Actual y apruébalos juntos.`,
      url: inv ? `/admin/dept/${inv.id}?tab=stock-actual` : "/admin",
    }).catch(() => null);
  }
  return NextResponse.json(r);
}
