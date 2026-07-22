import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { requireAdminSession } from "@/lib/guards";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const { id } = await params;
  const process = await prisma.process.findUnique({
    where: { id },
    include: {
      flowSteps: {
        include: { branches: true, checklistItems: { orderBy: { order: "asc" } } },
        orderBy: { order: "asc" },
      },
    },
  });
  if (!process) return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  if (session.user.role === "employee" && session.user.deptId !== process.deptId) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  return NextResponse.json(process);
}

const nodeSchema = z.object({
  clientId: z.string().min(1),
  type: z.enum([
    "START",
    "END",
    "PROCESS",
    "DECISION",
    "IO",
    "SUBPROCESS",
    "DOCUMENT",
    "PREPARE",
    "STORAGE",
    "CONNECTOR",
    "CHECKLIST",
  ]),
  label: z.string().default(""),
  detail: z.string().default(""),
  fileUrl: z.string().nullable().optional(),
  fileName: z.string().nullable().optional(),
  checklistItems: z.array(z.object({ text: z.string().trim().min(1) })).default([]),
  positionX: z.number(),
  positionY: z.number(),
});

const edgeSchema = z.object({
  sourceClientId: z.string().min(1),
  targetClientId: z.string().min(1),
  sourceHandle: z.string().nullable().optional(),
  targetHandle: z.string().nullable().optional(),
  label: z.string().default(""),
});

const updateSchema = z.object({
  title: z.string().trim().min(1).optional(),
  description: z.string().optional(),
  flow: z
    .object({
      nodes: z.array(nodeSchema),
      edges: z.array(edgeSchema),
    })
    .optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }
  const data = parsed.data;

  await prisma.$transaction(async (tx) => {
    if (data.title !== undefined || data.description !== undefined) {
      await tx.process.update({
        where: { id },
        data: {
          ...(data.title !== undefined ? { title: data.title } : {}),
          ...(data.description !== undefined ? { description: data.description } : {}),
        },
      });
    }

    if (data.flow !== undefined) {
      await tx.flowStep.deleteMany({ where: { processId: id } });

      const clientIdToDbId = new Map<string, string>();
      for (let i = 0; i < data.flow.nodes.length; i++) {
        const n = data.flow.nodes[i];
        const created = await tx.flowStep.create({
          data: {
            processId: id,
            type: n.type,
            label: n.label,
            detail: n.detail,
            fileUrl: n.fileUrl ?? null,
            fileName: n.fileName ?? null,
            order: i,
            positionX: n.positionX,
            positionY: n.positionY,
          },
        });
        clientIdToDbId.set(n.clientId, created.id);

        if (n.checklistItems.length > 0) {
          await tx.flowStepChecklistItem.createMany({
            data: n.checklistItems.map((c, index) => ({
              stepId: created.id,
              text: c.text,
              order: index,
            })),
          });
        }
      }

      for (const e of data.flow.edges) {
        const sourceId = clientIdToDbId.get(e.sourceClientId);
        const targetId = clientIdToDbId.get(e.targetClientId);
        if (!sourceId) continue;
        await tx.flowBranch.create({
          data: {
            stepId: sourceId,
            targetStepId: targetId ?? null,
            label: e.label,
            sourceHandle: e.sourceHandle ?? null,
            targetHandle: e.targetHandle ?? null,
          },
        });
      }
    }
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  await prisma.process.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
