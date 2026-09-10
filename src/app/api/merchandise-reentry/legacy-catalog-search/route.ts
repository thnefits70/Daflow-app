import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/guards";

// Mismo shape que catalog-search/route.ts (usado por ProductMatchPicker),
// pero gateado a admin en vez de canCaptureMerchandiseReentry — admin no es
// parte del equipo de Inventario, así que no pasa ese guard. Solo para la
// herramienta de vincular productos huérfanos (ver legacy-unlinked/route.ts).
export async function GET() {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const items = await prisma.purchaseCatalogItem.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, photos: true, justCode: true, pendingRegistration: true },
  });
  return NextResponse.json(items);
}
