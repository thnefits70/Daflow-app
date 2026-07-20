import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { requireAdminSession, canManageNomina } from "@/lib/guards";
import { hashPassword } from "@/lib/password";

function omitPasswordHash<T extends { passwordHash: string }>(user: T): Omit<T, "passwordHash"> {
  const safe: Partial<T> = { ...user };
  delete safe.passwordHash;
  return safe as Omit<T, "passwordHash">;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const user = await prisma.user.findUnique({
    where: { id },
    include: {
      milestones: { orderBy: { date: "desc" } },
      examScores: { orderBy: { createdAt: "desc" }, include: { exam: { select: { title: true } } } },
    },
  });
  if (!user) return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  return NextResponse.json(omitPasswordHash(user));
}

const updateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  username: z.string().trim().min(1).optional(),
  position: z.string().trim().nullable().optional(),
  password: z.string().min(4).optional(),
  deptId: z.string().nullable().optional(),
  photoUrl: z.string().nullable().optional(),
  email: z.string().trim().nullable().optional(),
  phone: z.string().trim().nullable().optional(),
  startDate: z.string().nullable().optional(),
  birthDate: z.string().nullable().optional(),
  skills: z.array(z.string()).optional(),
  cvUrl: z.string().nullable().optional(),
  cvName: z.string().nullable().optional(),
  isLeader: z.boolean().optional(),
  leadsDeptId: z.string().nullable().optional(),
  canManageLaws: z.boolean().optional(),
  canAddSuppliers: z.boolean().optional(),
  isActive: z.boolean().optional(),
  // When assigning this user as leader of a department that already has a
  // different leader, the request is rejected with 409 unless this is set —
  // it confirms the admin wants to demote the existing leader.
  replaceLeader: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  if (session.user.role !== "admin" && !(await canManageNomina())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;

  // Only one person can lead a given department. If this assigns someone as
  // leader of a dept that already has a different leader, require explicit
  // confirmation (replaceLeader) rather than silently ending up with two.
  if (d.leadsDeptId) {
    const existingLeader = await prisma.user.findFirst({
      where: { leadsDeptId: d.leadsDeptId, isLeader: true, id: { not: id } },
      select: { name: true },
    });
    if (existingLeader && !d.replaceLeader) {
      return NextResponse.json({ error: "leader_exists", existingLeaderName: existingLeader.name }, { status: 409 });
    }
    if (existingLeader && d.replaceLeader) {
      await prisma.user.updateMany({
        where: { leadsDeptId: d.leadsDeptId, isLeader: true, id: { not: id } },
        data: { isLeader: false, leadsDeptId: null },
      });
    }
  }

  const data: Record<string, unknown> = {};
  if (d.name !== undefined) data.name = d.name;
  if (d.username !== undefined) data.username = d.username.toLowerCase();
  if (d.position !== undefined) data.position = d.position || null;
  if (d.password) data.passwordHash = await hashPassword(d.password);
  if (d.deptId !== undefined) data.deptId = d.deptId;
  if (d.photoUrl !== undefined) data.photoUrl = d.photoUrl;
  if (d.email !== undefined) data.email = d.email;
  if (d.phone !== undefined) data.phone = d.phone;
  if (d.startDate !== undefined) data.startDate = d.startDate ? new Date(d.startDate) : null;
  if (d.birthDate !== undefined) data.birthDate = d.birthDate ? new Date(d.birthDate) : null;
  if (d.skills !== undefined) data.skills = d.skills;
  if (d.cvUrl !== undefined) data.cvUrl = d.cvUrl;
  if (d.cvName !== undefined) data.cvName = d.cvName;
  if (d.isLeader !== undefined) data.isLeader = d.isLeader;
  if (d.leadsDeptId !== undefined) data.leadsDeptId = d.leadsDeptId;
  if (d.canManageLaws !== undefined) data.canManageLaws = d.canManageLaws;
  if (d.canAddSuppliers !== undefined) data.canAddSuppliers = d.canAddSuppliers;
  if (d.isActive !== undefined) data.isActive = d.isActive;

  try {
    const user = await prisma.user.update({ where: { id }, data });
    return NextResponse.json(omitPasswordHash(user));
  } catch {
    return NextResponse.json({ error: "Ya existe un usuario con ese nombre de usuario." }, { status: 409 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  await prisma.user.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
