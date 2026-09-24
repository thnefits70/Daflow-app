import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/guards";
import { normalizeEmail } from "@/lib/supplierSheetAccess";

// Confirmado 2026-09-24, pedido explícito del usuario: SOLO el admin decide
// qué correos pueden abrir la hoja de CHEN (agregar, quitar, "solo ver").
// Quitar un correo borra sus sesiones en cascada: pierde el acceso al instante.

async function guard(supplierId: string) {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId }, select: { id: true } });
  if (!supplier) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  return null;
}

async function list(supplierId: string) {
  const rows = await prisma.supplierSheetEmail.findMany({ where: { supplierId }, orderBy: { createdAt: "asc" } });
  return rows.map((r) => ({ id: r.id, email: r.email, canWrite: r.canWrite, createdAt: r.createdAt, lastAccessAt: r.lastAccessAt }));
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ supplierId: string }> }) {
  const { supplierId } = await params;
  const denied = await guard(supplierId);
  if (denied) return denied;
  return NextResponse.json(await list(supplierId));
}

// Acepta uno o varios correos pegados juntos (separados por coma, espacio o salto de línea).
export async function POST(req: NextRequest, { params }: { params: Promise<{ supplierId: string }> }) {
  const { supplierId } = await params;
  const denied = await guard(supplierId);
  if (denied) return denied;

  const body = z.object({ emails: z.string().max(5000), canWrite: z.boolean().optional() }).safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const candidates = [...new Set(body.data.emails.split(/[\s,;]+/).map(normalizeEmail).filter(Boolean))];
  const invalid = candidates.filter((e) => !z.string().email().safeParse(e).success);
  if (invalid.length) return NextResponse.json({ error: `Correo no válido: ${invalid.join(", ")}` }, { status: 400 });
  if (!candidates.length) return NextResponse.json({ error: "Escribe al menos un correo." }, { status: 400 });

  await prisma.supplierSheetEmail.createMany({
    data: candidates.map((email) => ({ supplierId, email, canWrite: body.data.canWrite ?? true })),
    skipDuplicates: true,
  });
  return NextResponse.json(await list(supplierId));
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ supplierId: string }> }) {
  const { supplierId } = await params;
  const denied = await guard(supplierId);
  if (denied) return denied;

  const body = z.object({ id: z.string().min(1), canWrite: z.boolean() }).safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  await prisma.supplierSheetEmail.updateMany({ where: { id: body.data.id, supplierId }, data: { canWrite: body.data.canWrite } });
  return NextResponse.json(await list(supplierId));
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ supplierId: string }> }) {
  const { supplierId } = await params;
  const denied = await guard(supplierId);
  if (denied) return denied;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Falta el correo." }, { status: 400 });
  await prisma.supplierSheetEmail.deleteMany({ where: { id, supplierId } });
  return NextResponse.json(await list(supplierId));
}
