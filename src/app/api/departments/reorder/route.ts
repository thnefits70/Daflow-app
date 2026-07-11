import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/guards";

const reorderSchema = z.object({
  orderedIds: z.array(z.string()).min(1),
});

export async function PATCH(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = reorderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }

  await prisma.$transaction(
    parsed.data.orderedIds.map((id, index) =>
      prisma.department.update({ where: { id }, data: { order: index } })
    )
  );

  return NextResponse.json({ ok: true });
}
