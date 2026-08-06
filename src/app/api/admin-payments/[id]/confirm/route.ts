import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canManageAdminPayments } from "@/lib/guards";

// Cierre de un solo clic por parte de Finanzas, una vez que el admin ya pagó
// y la IA validó el comprobante — mismo espíritu que el "declarar completado"
// de Caja Chica.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || !(await canManageAdminPayments())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const request = await prisma.adminPaymentRequest.findUnique({ where: { id } });
  if (!request) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (request.status !== "PAID") return NextResponse.json({ error: "Todavía no está pagada." }, { status: 409 });

  const updated = await prisma.adminPaymentRequest.update({
    where: { id },
    data: {
      status: "CONFIRMED",
      confirmedAt: new Date(),
      confirmedById: session.user.role === "admin" ? null : session.user.id,
    },
  });

  return NextResponse.json(updated);
}
