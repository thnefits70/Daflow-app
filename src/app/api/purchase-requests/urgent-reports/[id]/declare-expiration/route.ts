import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canReceivePurchasesTeam } from "@/lib/guards";

const schema = z.object({
  hasExpiration: z.boolean(),
  manufactureDate: z.string().trim().min(1).nullable().optional(),
  expirationDate: z.string().trim().min(1).optional(),
});

// Confirmado 2026-09-25, pedido explícito del usuario (caso Evil Goods
// Crema): reportes urgentes enviados ANTES de que "Informar urgente"
// preguntara la caducidad — el equipo de Inventario la declara acá una sola
// vez. Si la parte buena ya quedó registrada y Daniel todavía no la aprueba,
// se copia también a esa recepción para que no se la vuelvan a pedir.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canReceivePurchasesTeam()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const isAdmin = session.user.role === "admin";

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  if (parsed.data.hasExpiration && !parsed.data.expirationDate) {
    return NextResponse.json({ error: "Falta la fecha de vencimiento." }, { status: 400 });
  }

  const report = await prisma.purchaseRequestUrgentReport.findUnique({
    where: { id },
    include: {
      request: {
        select: {
          status: true,
          catalogItem: { select: { hasExpiration: true, awaitingDropiId: true } },
          receipt: { select: { id: true, receivedQuantity: true, expirationDeclared: true, approvedAt: true } },
        },
      },
    },
  });
  if (!report) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (report.isLateClaim) return NextResponse.json({ error: "No aplica a reclamos posteriores." }, { status: 409 });
  if (report.expirationDeclared !== null) return NextResponse.json({ error: "La caducidad de este reporte ya fue declarada." }, { status: 409 });
  if (report.request.catalogItem.awaitingDropiId) {
    return NextResponse.json({ error: "Producto pendiente de ID de Dropi — el lote se declara cuando se libere al Kardex." }, { status: 409 });
  }
  if (report.request.catalogItem.hasExpiration && !parsed.data.hasExpiration) {
    return NextResponse.json({ error: "Este producto está marcado con caducidad — falta la fecha de vencimiento." }, { status: 400 });
  }

  const manufactureDate = parsed.data.hasExpiration && parsed.data.manufactureDate ? new Date(parsed.data.manufactureDate) : null;
  const expirationDate = parsed.data.hasExpiration && parsed.data.expirationDate ? new Date(parsed.data.expirationDate) : null;

  const updated = await prisma.purchaseRequestUrgentReport.update({
    where: { id },
    data: {
      expirationDeclared: parsed.data.hasExpiration,
      lotManufactureDate: manufactureDate,
      lotExpirationDate: expirationDate,
      lotDeclaredById: isAdmin ? null : session.user.id,
      lotDeclaredAt: new Date(),
    },
  });

  const receipt = report.request.receipt;
  if (receipt && !receipt.approvedAt && receipt.expirationDeclared === null && report.request.status === "RECEIVED_PENDING_REVIEW") {
    await prisma.purchaseRequestReceipt.update({
      where: { id: receipt.id },
      data: {
        expirationDeclared: parsed.data.hasExpiration,
        lotManufactureDate: manufactureDate,
        lotExpirationDate: expirationDate,
        lotQuantity: parsed.data.hasExpiration ? receipt.receivedQuantity : null,
      },
    });
  }

  return NextResponse.json(updated);
}
