import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// Solo admin — es quien recibe el push de "🚨 Informar urgente" y quien
// decide si corresponde crédito, reembolso, o ninguna acción con el proveedor.
export async function GET(_req: NextRequest) {
  const session = await auth();
  if (!session || session.user.role !== "admin") return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const reports = await prisma.purchaseRequestUrgentReport.findMany({
    orderBy: { reportedAt: "desc" },
    include: {
      reportedBy: { select: { name: true } },
      credit: true,
      request: {
        select: {
          quantity: true,
          totalCost: true,
          catalogItem: { select: { name: true } },
          supplier: { select: { id: true, name: true } },
        },
      },
    },
  });

  return NextResponse.json(reports);
}
