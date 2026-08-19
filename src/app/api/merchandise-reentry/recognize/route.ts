import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canCaptureMerchandiseReentry } from "@/lib/guards";
import { identifyReturnedProduct } from "@/lib/merchandiseReentryAi";

const schema = z.object({ photoUrls: z.array(z.string().url()).min(1).max(2) });

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!(await canCaptureMerchandiseReentry()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  try {
    const result = await identifyReturnedProduct({
      photoUrls: parsed.data.photoUrls,
      actorId: session.user.id,
      deptId: session.user.deptId ?? undefined,
    });
    if (!result.catalogItemId) return NextResponse.json({ catalogItem: null, note: result.note });

    const catalogItem = await prisma.purchaseCatalogItem.findUnique({
      where: { id: result.catalogItemId },
      select: { id: true, name: true, photos: true },
    });
    return NextResponse.json({ catalogItem, note: result.note });
  } catch (err) {
    console.error("[merchandise-reentry/recognize] error:", err);
    return NextResponse.json({ error: "No se pudo comparar la foto con el catálogo — puedes poner el nombre a mano." }, { status: 500 });
  }
}
