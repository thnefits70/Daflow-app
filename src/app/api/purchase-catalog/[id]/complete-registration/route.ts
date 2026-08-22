import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canSubmitPurchaseRequests, canCaptureMerchandiseReentry } from "@/lib/guards";

const schema = z.object({
  photos: z.array(z.string().url()).min(3, "Se necesitan mínimo 3 fotos para matricular el producto.").max(3),
  description: z.string().trim().max(500).optional(),
  code: z.string().trim().max(100).optional(),
});

// "Matricula" un producto esqueleto que vino de la Base de datos de Just
// (código+nombre conocidos, sin fotos, pendingRegistration=true) — pedido
// explícito del usuario 2026-08-21: mínimo 3 fotos reales o de referencia
// del proveedor, para que nadie en Compras/Reingreso se equivoque de
// producto por no tener con qué reconocerlo. Se puede disparar desde
// cualquiera de los dos módulos que comparten este catálogo.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const allowed = (await canSubmitPurchaseRequests()) || (await canCaptureMerchandiseReentry());
  if (!allowed) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }

  const item = await prisma.purchaseCatalogItem.findUnique({ where: { id } });
  if (!item) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (!item.pendingRegistration) {
    return NextResponse.json({ error: "Este producto ya está matriculado." }, { status: 409 });
  }

  const updated = await prisma.purchaseCatalogItem.update({
    where: { id },
    data: {
      photos: parsed.data.photos,
      description: parsed.data.description || null,
      code: parsed.data.code || item.code,
      pendingRegistration: false,
    },
  });
  return NextResponse.json(updated);
}
