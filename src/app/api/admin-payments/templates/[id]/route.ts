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
const schema = z
  .object({ isActive: z.boolean().optional(), numeroContrato: z.string().trim().min(1).optional() })
  .refine((d) => d.isActive !== undefined || d.numeroContrato !== undefined, { message: "Nada que actualizar." });

// Confirmado 2026-09-08: pedido explícito del usuario — el número de
// contrato del medidor (recurrentes de luz, ej. CNEL) se escribe una sola
// vez y queda bloqueado: si la plantilla ya tiene uno guardado, esta ruta
// rechaza el intento de pisarlo en vez de sobrescribirlo, para que el
// identificador del medidor no cambie por error.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canManageAdminPayments())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const data: { isActive?: boolean; numeroContrato?: string } = {};
  if (parsed.data.isActive !== undefined) data.isActive = parsed.data.isActive;

  if (parsed.data.numeroContrato !== undefined) {
    const existing = await prisma.adminPaymentTemplate.findUnique({ where: { id }, select: { numeroContrato: true } });
    if (!existing) return NextResponse.json({ error: "Plantilla no encontrada." }, { status: 404 });
    if (existing.numeroContrato) {
      return NextResponse.json({ error: "El número de contrato ya está registrado y no se puede modificar." }, { status: 409 });
    }
    data.numeroContrato = parsed.data.numeroContrato;
  }

  const updated = await prisma.adminPaymentTemplate.update({ where: { id }, data });
  return NextResponse.json(updated);
}
