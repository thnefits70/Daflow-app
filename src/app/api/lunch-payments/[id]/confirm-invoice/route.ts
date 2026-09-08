import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canRegisterLunchPayments } from "@/lib/guards";

// Confirmado 2026-09-08: pedido explícito del usuario — un solo clic donde
// Daniel informa que la proveedora le avisó (verbalmente) que sí envió la
// factura. No sube ningún archivo acá — la factura real la baja y la sube
// Nairoby más adelante, al verificar.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || !(await canRegisterLunchPayments())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const submission = await prisma.lunchWeekSubmission.findUnique({ where: { id } });
  if (!submission) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (submission.invoiceConfirmedAt) return NextResponse.json({ error: "Ya estaba confirmada." }, { status: 409 });

  const updated = await prisma.lunchWeekSubmission.update({
    where: { id },
    data: {
      invoiceConfirmedAt: new Date(),
      invoiceConfirmedById: session.user.role === "admin" ? null : session.user.id,
    },
  });

  return NextResponse.json(updated);
}
