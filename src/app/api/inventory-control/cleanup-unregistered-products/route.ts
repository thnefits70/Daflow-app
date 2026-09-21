import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/guards";
import { findUnusedSkeletonCatalogItems, deleteUnusedSkeletonCatalogItemsBulk } from "@/lib/stockKardex";

// Confirmado 2026-09-21, pedido explícito del usuario (admin): botón
// exclusivo suyo en Stock Actual para borrar de verdad los productos
// "esqueleto" que la importación de Just crea automáticamente (código +
// nombre nada más, sin fotos, `pendingRegistration: true`) y que nunca
// llegaron a comprarse — son la razón real detrás de buena parte de "Sin
// precio"/"Sin stock". Mismo patrón de vista previa + confirmación
// explícita que los otros botones de esta pantalla, pero a diferencia de
// esos (que solo corrigen números), este SÍ borra filas de verdad — por
// eso re-revisa cada producto uno por uno antes de borrarlo (ver
// checkCatalogItemDeletable en stockKardex.ts), en vez de confiar
// ciegamente en la lista que ya se le mostró al admin en la vista previa.
export async function GET() {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const candidates = await findUnusedSkeletonCatalogItems();
  return NextResponse.json(candidates);
}

export async function POST() {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const result = await deleteUnusedSkeletonCatalogItemsBulk();
  return NextResponse.json(result);
}
