import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canViewPayrollRoles } from "@/lib/guards";

export async function GET() {
  if (!(await canViewPayrollRoles())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const tiers = await prisma.commissionTier.findMany({ where: { isActive: true }, orderBy: { orderIndex: "asc" } });
  return NextResponse.json(tiers);
}
