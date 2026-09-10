import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canManageJustCatalog } from "@/lib/guards";
import { declareExpirationLot, getActiveExpirationLots, getAllExpirationLots } from "@/lib/stockKardex";

// Confirmado 2026-09-10 (pedido de Daniel): declarar el lote de un producto
// que YA está en percha, sin depender de esperar la próxima compra — mismo
// permiso que "Etiquetas de percha" (Daniel + admin).
const schema = z.object({
  manufactureDate: z.string().trim().min(1).nullable().optional(),
  expirationDate: z.string().trim().min(1),
  quantity: z.number().int().positive(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canManageJustCatalog()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const isAdmin = session.user.role === "admin";
  const cohort = await declareExpirationLot({
    catalogItemId: id,
    manufactureDate: parsed.data.manufactureDate ? new Date(parsed.data.manufactureDate) : null,
    expirationDate: new Date(parsed.data.expirationDate),
    quantity: parsed.data.quantity,
    declaredById: isAdmin ? null : session.user.id,
  });
  return NextResponse.json(cohort, { status: 201 });
}

// activeOnly=true: lectura abierta a cualquiera autenticado (la usa el
// recordatorio informativo al escanear en la percha). Sin ese parámetro,
// devuelve el historial completo (activos y agotados) — solo Daniel/admin.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const activeOnly = req.nextUrl.searchParams.get("activeOnly") === "1";

  if (!activeOnly && !(await canManageJustCatalog())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const lots = activeOnly ? await getActiveExpirationLots(id) : await getAllExpirationLots(id);
  return NextResponse.json(lots);
}
