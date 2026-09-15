import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canSubmitPurchaseRequests } from "@/lib/guards";

// Confirmado 2026-07-30: Control de Compras lee/escribe la MISMA tabla
// Supplier que la sección de Proveedores (nunca dos registros del mismo
// contacto) — pero con SU PROPIO permiso (canSubmitPurchaseRequests), no el
// de Proveedores (getSupplierAccess), porque Bryan/Compras hoy no tiene
// permiso para crear ahí y sí lo necesita aquí para poder solicitar.
export async function GET(req: NextRequest) {
  if (!(await canSubmitPurchaseRequests())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const type = req.nextUrl.searchParams.get("type") === "CARRIER" ? "CARRIER" : "SUPPLIER";
  const q = req.nextUrl.searchParams.get("q")?.trim();

  const suppliers = await prisma.supplier.findMany({
    where: {
      type,
      status: "APPROVED",
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { bankAccounts: { some: { bankAccountNumber: { contains: q } } } },
              { contacts: { some: { whatsapp: { contains: q } } } },
            ],
          }
        : {}),
    },
    orderBy: { name: "asc" },
    include: { contacts: { orderBy: { id: "asc" } }, bankAccounts: { orderBy: { createdAt: "asc" } } },
    take: 30,
  });
  return NextResponse.json(suppliers);
}

// Confirmado 2026-07-30: debe pedir los MISMOS datos que ya pide la sección
// Proveedores al crear uno (category opcional, notes obligatoria — ver
// createSchema en src/app/api/suppliers/route.ts).
// Fix confirmado 2026-09-15: bug real — el banco venía obligatorio incluso
// para un transportista que solo cobra en efectivo (no tiene cuenta, y
// nunca la va a tener), bloqueando registrarlo. Mismo criterio "opcional,
// todo o nada" que ya usa Proveedores (SuppliersPanel.tsx): la cuenta se
// valida aparte, en el cliente, y si se completó se crea con una llamada
// separada a POST /api/purchase-suppliers/[id]/bank-accounts (mismo
// endpoint que ya usa "agregar cuenta" a un proveedor existente) — este
// endpoint ya no la exige ni la crea.
const createSchema = z.object({
  type: z.enum(["SUPPLIER", "CARRIER"]),
  name: z.string().trim().min(1, "Falta el nombre."),
  category: z.string().trim().optional(),
  notes: z.string().trim().min(1, "Agrega una descripción — qué provee o qué transporta."),
  email: z.string().trim().email().optional().or(z.literal("")),
  // Obligatoria para SUPPLIER, no aplica a CARRIER (no tiene local fijo).
  location: z.string().trim().optional(),
  // Asesor/contacto — nombre y celular, mismo campo que usa Proveedores hoy.
  contactLabel: z.string().trim().min(1, "Falta el nombre del asesor/contacto."),
  contactWhatsapp: z.string().trim().min(5, "Número de contacto inválido."),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!(await canSubmitPurchaseRequests()) || !session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }
  if (parsed.data.type === "SUPPLIER" && !parsed.data.location) {
    return NextResponse.json({ error: "Falta la ubicación del proveedor." }, { status: 400 });
  }

  const isAdmin = session.user.role === "admin";
  const supplier = await prisma.supplier.create({
    data: {
      type: parsed.data.type,
      name: parsed.data.name,
      category: parsed.data.category || null,
      notes: parsed.data.notes,
      location: parsed.data.type === "SUPPLIER" ? parsed.data.location : null,
      email: parsed.data.email || null,
      status: "APPROVED",
      createdById: isAdmin ? null : session.user.id,
      createdByDeptId: isAdmin ? null : session.user.deptId,
      approvedById: isAdmin ? null : session.user.id,
      approvedAt: new Date(),
      contacts: { create: [{ label: parsed.data.contactLabel, whatsapp: parsed.data.contactWhatsapp }] },
    },
    include: { contacts: true, bankAccounts: true },
  });
  return NextResponse.json(supplier, { status: 201 });
}
