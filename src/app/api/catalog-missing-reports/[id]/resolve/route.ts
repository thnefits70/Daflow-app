import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canManageJustCatalog } from "@/lib/guards";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canManageJustCatalog())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const session = await auth();
  const { id } = await params;

  const report = await prisma.catalogMissingReport.findUnique({ where: { id } });
  if (!report) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (report.resolvedAt) return NextResponse.json({ error: "Ya estaba resuelto." }, { status: 409 });

  const updated = await prisma.catalogMissingReport.update({
    where: { id },
    data: { resolvedAt: new Date(), resolvedById: session!.user.role === "admin" ? null : session!.user.id },
  });
  return NextResponse.json(updated);
}
