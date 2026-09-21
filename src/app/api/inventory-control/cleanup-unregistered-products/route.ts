import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminSession } from "@/lib/guards";
import { findUnusedSkeletonCatalogItems, deleteUnusedSkeletonCatalogItemsBulk } from "@/lib/stockKardex";

const schema = z.object({ catalogItemIds: z.array(z.string()).min(1) });

// Confirmado 2026-09-21, pedido explícito del usuario (admin): botón
// exclusivo suyo en Stock Actual para borrar de verdad los productos
// "esqueleto" que la importación de Just crea automáticamente (código +
// nombre nada más, sin fotos, `pendingRegistration: true`) y que nunca
// llegaron a comprarse — son la razón real detrás de buena parte de "Sin
// precio"/"Sin stock". GET trae los candidatos que pasan el filtro
// automático; POST NO borra "todos los candidatos" ciegamente — el admin
// revisó la lista y encontró productos reales ahí, así que ahora recibe
// justo los ids que el admin marcó a mano en pantalla (`catalogItemIds`),
// y los vuelve a validar contra la lista de candidatos recién calculada
// antes de borrar (ver deleteUnusedSkeletonCatalogItemsBulk).
export async function GET() {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const candidates = await findUnusedSkeletonCatalogItems();
  return NextResponse.json(candidates);
}

export async function POST(req: NextRequest) {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Selecciona al menos un producto." }, { status: 400 });

  const result = await deleteUnusedSkeletonCatalogItemsBulk(parsed.data.catalogItemIds);
  return NextResponse.json(result);
}
