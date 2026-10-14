import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getWarrantyDispatchRole, listWarrantyDispatchGuides, notifyHandlersNewGuide, userName } from "@/lib/warrantyDispatch";

export async function GET() {
  const role = await getWarrantyDispatchRole();
  if (!role) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const guides = await listWarrantyDispatchGuides();
  return NextResponse.json({ role, guides });
}

const createSchema = z.object({
  guideNumber: z.string().trim().min(3, "Escribe el número de guía.").max(60),
  fileUrl: z.string().url("Sube la guía."),
  fileName: z.string().max(300).optional().nullable(),
  comment: z.string().trim().max(2000).optional().nullable(),
});

// Solo Michelle y Yair suben guías de garantía ya autorizada.
export async function POST(req: NextRequest) {
  const role = await getWarrantyDispatchRole();
  if (!role?.canUpload) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const guideNumber = parsed.data.guideNumber.toUpperCase().replace(/\s+/g, "");
  const open = await prisma.warrantyDispatchGuide.findFirst({ where: { guideNumber, verifiedAt: null }, select: { id: true } });
  if (open) return NextResponse.json({ error: "Esa guía ya está en la lista, pendiente de despachar." }, { status: 400 });

  const row = await prisma.warrantyDispatchGuide.create({
    data: {
      guideNumber,
      fileUrl: parsed.data.fileUrl,
      fileName: parsed.data.fileName ?? null,
      comment: parsed.data.comment?.trim() || null,
      uploadedById: role.userId,
    },
  });
  await notifyHandlersNewGuide(guideNumber, await userName(role.userId));
  return NextResponse.json({ id: row.id }, { status: 201 });
}
