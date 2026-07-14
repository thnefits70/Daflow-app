import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canAddSupplier, getSupplierAccess } from "@/lib/guards";

const supplierInclude = {
  contacts: { orderBy: { id: "asc" as const } },
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

const createSchema = z.object({
  name: z.string().trim().min(1, "El nombre del proveedor es obligatorio."),
  location: z.string().trim().optional(),
  locationLat: z.number().min(-90).max(90).nullable().optional(),
  locationLng: z.number().min(-180).max(180).nullable().optional(),
  category: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  contacts: z
    .array(
      z.object({
        label: z.string().trim().min(1, "Falta el nombre del contacto."),
        whatsapp: z.string().trim().min(5, "Número de WhatsApp inválido."),
      })
    )
    .min(1, "Agrega al menos un contacto de WhatsApp."),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const canAdd = await canAddSupplier();
  if (!canAdd) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }
  const { contacts, ...rest } = parsed.data;

  // Admin isn't a real User row (its session id is the literal "admin"), so
  // admin-authored actions never populate the User relations — only the
  // employee-authored ones do. The UI falls back to "Administrador" when
  // approved/created with no linked user.
  const isAdmin = session.user.role === "admin";

  const supplier = await prisma.supplier.create({
    data: {
      ...rest,
      status: isAdmin ? "APPROVED" : "PENDING",
      createdById: isAdmin ? null : session.user.id,
      createdByDeptId: isAdmin ? null : session.user.deptId,
      approvedAt: isAdmin ? new Date() : null,
      contacts: { create: contacts },
    },
    include: supplierInclude,
  });
  return NextResponse.json(supplier, { status: 201 });
}
