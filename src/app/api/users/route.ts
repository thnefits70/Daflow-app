import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/guards";
import { hashPassword } from "@/lib/password";

export async function GET() {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const users = await prisma.user.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      username: true,
      position: true,
      photoUrl: true,
      deptId: true,
      department: { select: { id: true, name: true, code: true } },
      isLeader: true,
      leadsDeptId: true,
    },
  });
  return NextResponse.json(users);
}

const createSchema = z.object({
  name: z.string().trim().min(1, "El nombre es obligatorio."),
  username: z.string().trim().min(1, "El usuario es obligatorio."),
  password: z.string().min(4, "La contraseña debe tener al menos 4 caracteres."),
  deptId: z.string().min(1),
  position: z.string().trim().optional(),
});

export async function POST(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }

  const passwordHash = await hashPassword(parsed.data.password);
  try {
    const user = await prisma.user.create({
      data: {
        name: parsed.data.name,
        username: parsed.data.username.toLowerCase(),
        passwordHash,
        deptId: parsed.data.deptId,
        position: parsed.data.position || null,
      },
      select: { id: true, name: true, username: true, position: true },
    });
    return NextResponse.json(user, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Ya existe un usuario con ese nombre de usuario." }, { status: 409 });
  }
}
