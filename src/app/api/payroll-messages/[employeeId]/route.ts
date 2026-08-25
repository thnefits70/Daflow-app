import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canSendPayrollMessage, canViewPayrollMessages } from "@/lib/guards";
import { notifyOwner } from "@/lib/notifications";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ employeeId: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const { employeeId } = await params;
  if (!(await canViewPayrollMessages(employeeId))) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const messages = await prisma.payrollMessage.findMany({
    where: { employeeId },
    orderBy: { createdAt: "asc" },
    include: { sender: { select: { name: true } } },
  });

  // El admin solo observa — no consume el estado de "leído" pensado para la
  // conversación real entre el colaborador y quien gestiona su nómina.
  if (session.user.role !== "admin") {
    await prisma.payrollMessage.updateMany({
      where: { employeeId, senderId: { not: session.user.id }, readAt: null },
      data: { readAt: new Date() },
    });
  }

  return NextResponse.json(
    messages.map((m) => ({
      id: m.id,
      senderId: m.senderId,
      senderName: m.sender.name,
      body: m.body,
      createdAt: m.createdAt,
    }))
  );
}

const sendSchema = z.object({ body: z.string().trim().min(1, "Escribe un mensaje.") });

export async function POST(req: NextRequest, { params }: { params: Promise<{ employeeId: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const { employeeId } = await params;
  if (!(await canSendPayrollMessage(employeeId))) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = sendSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }

  const created = await prisma.payrollMessage.create({
    data: { employeeId, senderId: session.user.id, body: parsed.data.body },
    include: { sender: { select: { name: true } } },
  });

  const preview = created.body.length > 100 ? `${created.body.slice(0, 100)}…` : created.body;

  if (session.user.id === employeeId) {
    // El colaborador le escribió a Nómina: avisar a quien gestiona nómina
    // (líder de Finanzas) con acceso directo a esa conversación.
    const managers = await prisma.user.findMany({
      where: { isLeader: true, leadsDept: { code: "FIN" } },
      select: { id: true },
    });
    const employee = await prisma.user.findUnique({ where: { id: employeeId }, select: { deptId: true } });
    await Promise.all(
      managers.map((m) =>
        notifyOwner(m.id, {
          title: `${created.sender.name} te escribió`,
          body: preview,
          url: `/area/roles-de-pago?employee=${employeeId}${employee?.deptId ? `&dept=${employee.deptId}` : ""}`,
        })
      )
    );
  } else {
    // Nómina le escribió al colaborador: avisar con acceso directo a su
    // propia conversación ("Mensajes con Nómina" en Roles de pago).
    await notifyOwner(employeeId, {
      title: "Nómina te escribió",
      body: preview,
      url: "/area/roles-de-pago",
    });
  }

  return NextResponse.json(
    {
      id: created.id,
      senderId: created.senderId,
      senderName: created.sender.name,
      body: created.body,
      createdAt: created.createdAt,
    },
    { status: 201 }
  );
}
