import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canManageLocalWarranties, dbUserId } from "@/lib/guards";
import { createLocalWarranty } from "@/lib/localWarranty";

export const maxDuration = 60;

const schema = z.object({
  ref: z.string().trim().min(1, "Falta la guía o venta original."),
  deliver: z
    .array(
      z.object({
        catalogItemId: z.string().min(1),
        quantity: z.number().int().positive(),
        reason: z.enum(["MAL_FUNCIONAMIENTO", "PRODUCTO_ROTO", "ORDEN_INCOMPLETA", "ORDEN_DIFERENTE"]),
        pickupDefective: z.boolean(),
      })
    )
    .min(1, "Elige al menos un producto a entregar."),
  extras: z.array(z.object({ catalogItemId: z.string().min(1), quantity: z.number().int().positive(), reason: z.enum(["ORDEN_DIFERENTE", "ENVIADO_DE_MAS"]), pickup: z.boolean() })).default([]),
  clientPhone: z.string().trim().default(""),
  clientName: z.string().trim().nullable().optional(),
  clientAddress: z.string().trim().nullable().optional(),
  chargeMode: z.enum(["NONE", "ORIGINAL", "CUSTOM"]),
  chargeAmount: z.number().nullable().optional(),
  freightCost: z.number(),
  pickupPersonName: z.string().trim(),
  evidenceUrls: z.array(z.string().url()).max(10).default([]),
  acceptLate: z.boolean().default(false),
});

const WARRANTY_INCLUDE = {
  items: { include: { catalogItem: { select: { name: true, photos: true, justCode: true } }, pickupReceivedBy: { select: { name: true } } }, orderBy: { createdAt: "asc" } },
  dispatchAssignedTo: { select: { name: true } },
  packAssignedTo: { select: { name: true } },
  deliveredBy: { select: { name: true } },
  freightPaidBy: { select: { name: true } },
  warrantySourceSale: { select: { code: true } },
} as const;

// Mis garantías (las del asesor que pregunta).
export async function GET() {
  const session = await auth();
  if (!(await canManageLocalWarranties()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const rows = await prisma.externalSale.findMany({
    where: { advisorId: session.user.id, kind: "WARRANTY" },
    include: WARRANTY_INCLUDE,
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json(rows);
}

// Crear la garantía (doble confirmación en pantalla). Desde 2026-10-05 nace
// esperando a Bryan (pedido del usuario); al aprobar pasa a INVESTOCK.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!(await canManageLocalWarranties()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const advisorId = dbUserId(session.user.id);
  if (!advisorId) return NextResponse.json({ error: "Solo un asesor puede registrar garantías." }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  const result = await createLocalWarranty(parsed.data, advisorId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result);
}
