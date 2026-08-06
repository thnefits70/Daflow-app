import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// Solo admin — es quien de verdad revisa su cuenta bancaria. El doble
// "¿estás seguro?" vive en el cliente (pantalla de confirmación con los
// valores antes de este POST); desde que confirma, el reembolso queda bajo
// su responsabilidad.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || session.user.role !== "admin") return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const resolution = await prisma.purchaseUrgentResolution.findUnique({ where: { id } });
  if (!resolution || resolution.type !== "REFUND") return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (!resolution.refundAiMatch) return NextResponse.json({ error: "Todavía no hay un comprobante verificado." }, { status: 409 });
  if (resolution.status !== "PENDING") return NextResponse.json({ error: "Ya fue confirmado." }, { status: 409 });

  const updated = await prisma.purchaseUrgentResolution.update({
    where: { id },
    data: { status: "COMPLETED", bankConfirmedAt: new Date(), bankConfirmedById: null },
  });

  return NextResponse.json(updated);
}
