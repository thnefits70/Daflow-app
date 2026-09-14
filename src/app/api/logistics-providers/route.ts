import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canDeclareExternalSales } from "@/lib/guards";

// Registro compartido de motorizados/couriers de Ventas Externas — mismo
// patrón que /api/clients: cualquier asesor lo ve y puede registrar uno
// nuevo, para que otro asesor lo reutilice sin volver a escribirlo.
export async function GET() {
  const session = await auth();
  if (!(await canDeclareExternalSales()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const providers = await prisma.logisticsProvider.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json(providers);
}

const createSchema = z.object({
  name: z.string().trim().min(1, "Falta el nombre del motorizado o transportadora."),
  phone: z.string().trim().optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!(await canDeclareExternalSales()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const existing = await prisma.logisticsProvider.findFirst({ where: { name: { equals: parsed.data.name, mode: "insensitive" } } });
  if (existing) {
    return NextResponse.json(
      { error: "Ya existe un proveedor registrado con ese nombre — selecciónalo en vez de crear uno nuevo.", existingProvider: existing },
      { status: 409 }
    );
  }

  const isAdmin = session.user.role === "admin";
  const provider = await prisma.logisticsProvider.create({
    data: {
      name: parsed.data.name,
      phone: parsed.data.phone || null,
      createdById: isAdmin ? null : session.user.id,
    },
  });
  return NextResponse.json(provider, { status: 201 });
}
