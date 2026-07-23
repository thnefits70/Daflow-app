import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canManageStoreFeedback } from "@/lib/guards";

const createSchema = z.object({
  name: z.string().trim().min(1, "El nombre de la tienda es obligatorio."),
  contactName: z.string().trim().optional(),
  contactPhone: z.string().trim().optional(),
});

export async function POST(req: NextRequest) {
  if (!(await canManageStoreFeedback())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }

  const store = await prisma.store.create({
    data: {
      name: parsed.data.name,
      contactName: parsed.data.contactName || null,
      contactPhone: parsed.data.contactPhone || null,
    },
  });

  return NextResponse.json(store, { status: 201 });
}
