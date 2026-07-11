import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/guards";

export async function GET() {
  const departments = await prisma.department.findMany({ orderBy: { order: "asc" } });
  return NextResponse.json(departments);
}

const createSchema = z.object({
  name: z.string().trim().min(1, "El nombre es obligatorio."),
  code: z.string().trim().min(1).max(8),
});

export async function POST(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }

  const last = await prisma.department.findFirst({ orderBy: { order: "desc" } });
  try {
    const department = await prisma.department.create({
      data: {
        name: parsed.data.name,
        code: parsed.data.code.toUpperCase(),
        order: (last?.order ?? -1) + 1,
      },
    });
    return NextResponse.json(department, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Ya existe un área con ese código." }, { status: 409 });
  }
}
