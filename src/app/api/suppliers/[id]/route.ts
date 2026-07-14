import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/guards";

const contactSchema = z.object({
  label: z.string().trim().min(1, "Falta el nombre del contacto."),
  whatsapp: z.string().trim().min(5, "Número de WhatsApp inválido."),
});

const updateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  location: z.string().trim().nullable().optional(),
  locationLat: z.number().min(-90).max(90).nullable().optional(),
  locationLng: z.number().min(-180).max(180).nullable().optional(),
  category: z.string().trim().nullable().optional(),
  notes: z.string().trim().min(1, "Agrega una descripción del proveedor en Notas.").optional(),
  contacts: z.array(contactSchema).min(1, "Agrega al menos un contacto de WhatsApp.").optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }
  const { contacts, ...rest } = parsed.data;

  const supplier = await prisma.supplier
    .update({
      where: { id },
      data: {
        ...rest,
        ...(contacts
          ? { contacts: { deleteMany: {}, create: contacts.map((c) => ({ label: c.label, whatsapp: c.whatsapp })) } }
          : {}),
      },
      include: { contacts: true, createdBy: { select: { name: true } }, approvedBy: { select: { name: true } } },
    })
    .catch(() => null);
  if (!supplier) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  return NextResponse.json(supplier);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }
  const { id } = await params;

  await prisma.supplier.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
