import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canManageAdminPayments } from "@/lib/guards";

// Confirmado 2026-09-08: pedido explícito del usuario, tras detectar que un
// motivo recurrente ya pagado (ej. una semana de almuerzos que no se repite)
// se quedaba pegado para siempre en "Pendientes de registrar este mes"
// porque no existía forma de desactivarlo desde la app. Desactivar no borra
// el historial (los AdminPaymentRequest ya creados con este templateId
// siguen intactos) — solo saca la plantilla de la lista de "activas" que se
// compara contra el período actual.
const schema = z.object({ isActive: z.boolean() });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canManageAdminPayments())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const updated = await prisma.adminPaymentTemplate.update({ where: { id }, data: { isActive: parsed.data.isActive } });
  return NextResponse.json(updated);
}
