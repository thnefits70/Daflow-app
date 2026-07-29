import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSupplierAccess } from "@/lib/guards";

const contactSchema = z.object({
  label: z.string().trim().min(1, "Falta el nombre del contacto."),
  whatsapp: z.string().trim().min(5, "Número de WhatsApp inválido."),
});

// Confirmado 2026-07-30: a diferencia del PATCH completo del proveedor
// (admin-only, y que reemplaza TODOS los contactos a la vez), esto solo
// AGREGA un contacto nuevo — quien ya puede crear proveedores (canAdd,
// mismo permiso de "Nuevo proveedor") puede sumar un asesor nuevo que
// consiguió por su bodega, sin poder editar ni eliminar los que ya existen.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await getSupplierAccess();
  if (!access.canAdd) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = contactSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }

  const supplier = await prisma.supplier.findUnique({ where: { id }, select: { id: true } });
  if (!supplier) return NextResponse.json({ error: "Proveedor no encontrado." }, { status: 404 });

  const contact = await prisma.supplierContact.create({
    data: { supplierId: id, label: parsed.data.label, whatsapp: parsed.data.whatsapp },
  });
  return NextResponse.json(contact, { status: 201 });
}
