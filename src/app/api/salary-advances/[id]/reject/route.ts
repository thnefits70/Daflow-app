import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canManageSalaryAdvances } from "@/lib/guards";
import { notifyOwner } from "@/lib/notifications";

const schema = z.object({ reason: z.string().trim().min(1, "Contá el motivo del rechazo.") });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canManageSalaryAdvances())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const session = await auth();
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const advance = await prisma.salaryAdvance.findUnique({ where: { id } });
  if (!advance) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (advance.status !== "PENDING") return NextResponse.json({ error: "Ya fue procesado." }, { status: 409 });

  const isAdmin = session!.user.role === "admin";
  const updated = await prisma.salaryAdvance.update({
    where: { id },
    data: { status: "REJECTED", rejectedAt: new Date(), rejectedById: isAdmin ? null : session!.user.id },
  });

  await notifyOwner(advance.employeeId, {
    title: "❌ Tu anticipo fue rechazado",
    body: parsed.data.reason,
    url: "/area/anticipos",
  }).catch(() => null);

  return NextResponse.json(updated);
}
