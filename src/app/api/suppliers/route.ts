import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { getSupplierAccess } from "@/lib/guards";

const supplierInclude = {
  contacts: { orderBy: { id: "asc" as const } },
  channels: { orderBy: { id: "asc" as const } },
  createdBy: { select: { name: true } },
  approvedBy: { select: { name: true } },
};

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status") === "pending" ? "pending" : "approved";
  const access = await getSupplierAccess();

  if (status === "approved") {
    if (!access.canView) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    const suppliers = await prisma.supplier.findMany({
      where: { status: "APPROVED" },
      orderBy: { name: "asc" },
      include: supplierInclude,
    });
    return NextResponse.json(suppliers);
  }

  // status === "pending": admin sees everything awaiting/decided; a leader
  // only sees what was proposed by someone in the department they lead.
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  if (session.user.role === "admin") {
    const suppliers = await prisma.supplier.findMany({
      where: { status: { in: ["PENDING", "REJECTED"] } },
      orderBy: { createdAt: "desc" },
      include: supplierInclude,
    });
    return NextResponse.json(suppliers);
  }

  if (!access.isLeader || !access.leadsDeptId) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }
  const suppliers = await prisma.supplier.findMany({
    where: { status: { in: ["PENDING", "REJECTED"] }, createdByDeptId: access.leadsDeptId },
    orderBy: { createdAt: "desc" },
    include: supplierInclude,
  });
  return NextResponse.json(suppliers);
}

const channelSchema = z.object({
  platform: z.enum(["TELEGRAM", "INSTAGRAM", "FACEBOOK", "OTHER"]),
  url: z.string().trim().min(1, "Falta el enlace del canal.").url("Enlace inválido."),
});

const createSchema = z.object({
  name: z.string().trim().min(1, "El nombre del proveedor es obligatorio."),
  location: z.string().trim().optional(),
  locationLat: z.number().min(-90).max(90).nullable().optional(),
  locationLng: z.number().min(-180).max(180).nullable().optional(),
  category: z.string().trim().optional(),
  notes: z.string().trim().min(1, "Agrega una descripción del proveedor en Notas."),
  contacts: z
    .array(
      z.object({
        label: z.string().trim().min(1, "Falta el nombre del contacto."),
        whatsapp: z.string().trim().min(5, "Número de WhatsApp inválido."),
      })
    )
    .min(1, "Agrega al menos un contacto de WhatsApp."),
  channels: z.array(channelSchema).optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const access = await getSupplierAccess();
  if (!access.canAdd) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }
  const { contacts, channels, ...rest } = parsed.data;

  // Admin isn't a real User row (its session id is the literal "admin"), so
  // admin-authored actions never populate the User relations — only the
  // employee-authored ones do. The UI falls back to "Administrador" when
  // approved/created with no linked user.
  const isAdmin = session.user.role === "admin";
  // A leader creating a supplier for their own área would just approve it
  // themselves anyway, so skip the round trip and save it approved directly.
  const isSelfApproving = access.isLeader && access.leadsDeptId === session.user.deptId;
  const autoApproved = isAdmin || isSelfApproving;

  const supplier = await prisma.supplier.create({
    data: {
      ...rest,
      status: autoApproved ? "APPROVED" : "PENDING",
      createdById: isAdmin ? null : session.user.id,
      createdByDeptId: isAdmin ? null : session.user.deptId,
      approvedById: isSelfApproving ? session.user.id : null,
      approvedAt: autoApproved ? new Date() : null,
      contacts: { create: contacts },
      channels: channels && channels.length > 0 ? { create: channels } : undefined,
    },
    include: supplierInclude,
  });
  return NextResponse.json(supplier, { status: 201 });
}
