import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canManagePayroll } from "@/lib/guards";
import { sendPayStubEmail } from "@/lib/email";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const canManage = await canManagePayroll();

  if (!canManage) {
    const stubs = await prisma.payStub.findMany({
      where: { userId: session.user.id },
      orderBy: [{ year: "desc" }, { month: "desc" }],
    });
    return NextResponse.json({ mode: "own", stubs });
  }

  const deptId = req.nextUrl.searchParams.get("deptId");
  const month = Number(req.nextUrl.searchParams.get("month"));
  const year = Number(req.nextUrl.searchParams.get("year"));
  if (!deptId || !month || !year) {
    return NextResponse.json({ error: "Faltan parámetros." }, { status: 400 });
  }

  const users = await prisma.user.findMany({
    where: { deptId, isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, position: true },
  });
  const stubs = await prisma.payStub.findMany({
    where: { userId: { in: users.map((u) => u.id) }, month, year },
  });
  const stubByUser = new Map(stubs.map((s) => [s.userId, s]));
  const roster = users.map((u) => ({ user: u, stub: stubByUser.get(u.id) ?? null }));
  return NextResponse.json({ mode: "manage", roster });
}

const upsertSchema = z.object({
  userId: z.string().min(1),
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2000).max(2100),
  fileUrl: z.string().min(1),
  fileName: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const canManage = await canManagePayroll();
  if (!canManage) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }
  const { userId, month, year, fileUrl, fileName } = parsed.data;

  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { deptId: true, name: true, email: true },
  });
  if (!targetUser) return NextResponse.json({ error: "Empleado no encontrado." }, { status: 404 });

  const isAdmin = session.user.role === "admin";
  const stub = await prisma.payStub.upsert({
    where: { userId_month_year: { userId, month, year } },
    create: {
      userId,
      month,
      year,
      fileUrl,
      fileName,
      deptId: targetUser.deptId,
      uploadedById: isAdmin ? null : session.user.id,
    },
    update: {
      fileUrl,
      fileName,
      uploadedById: isAdmin ? null : session.user.id,
    },
  });

  if (targetUser.email) {
    await sendPayStubEmail(targetUser.email, targetUser.name, month, year);
  }

  return NextResponse.json(stub, { status: 201 });
}
