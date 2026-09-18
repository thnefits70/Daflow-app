import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canManageOutflowPurchaseGestion, getPurchaseApproverIds } from "@/lib/guards";
import { notifyOwner } from "@/lib/notifications";
import { auth } from "@/auth";

const schema = z.object({
  note: z.string().trim().min(1, "Explica qué averiguaste con el proveedor."),
});

// Confirmado 2026-09-17: pedido explícito del usuario — el excedente
// (llegó más de lo pedido, ver excessQty en [id]/urgent-report/route.ts)
// nunca cuenta como stock real solo porque Inventario lo contó. Jariel
// (quien gestiona reclamos/coordinación con proveedores, mismo rol que
// canManageOutflowPurchaseGestion en el flujo de deterioro) verifica con el
// proveedor (factura, guía, o preguntarle directo) y deja constancia acá
// antes de que Bryan dé la confirmación final (ver excess-confirm/route.ts).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canManageOutflowPurchaseGestion()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const existing = await prisma.purchaseRequestUrgentReport.findUnique({
    where: { id },
    include: { request: { select: { catalogItem: { select: { name: true } } } } },
  });
  if (!existing) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (existing.excessQty <= 0) return NextResponse.json({ error: "Este reporte no tiene excedente." }, { status: 409 });
  if (!existing.reviewedByLeadAt) return NextResponse.json({ error: "Falta que Daniel revise el reporte primero." }, { status: 409 });
  if (existing.excessGestionAt) return NextResponse.json({ error: "Ya se dejó constancia de la gestión con el proveedor." }, { status: 409 });

  const isAdmin = session.user.role === "admin";
  const updated = await prisma.purchaseRequestUrgentReport.update({
    where: { id },
    data: { excessGestionNote: parsed.data.note, excessGestionById: isAdmin ? null : session.user.id, excessGestionAt: new Date() },
  });

  const approverIds = await getPurchaseApproverIds();
  await Promise.all(
    approverIds.map((ownerId) =>
      notifyOwner(ownerId, {
        title: "📦 Excedente listo para tu confirmación",
        body: `${existing.request.catalogItem.name} — ${existing.excessQty} un. de más, ya gestionado con el proveedor.`,
        url: "/area/workspace?tab=compras&ptab=urgentes",
      }).catch(() => null)
    )
  );

  return NextResponse.json(updated);
}
