import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canCaptureMerchandiseReentry } from "@/lib/guards";

// Confirmado 2026-08-20: pedido explícito del usuario — reemplaza el
// reconocimiento por IA (que tenía un costo real por cada foto) con una
// búsqueda manual contra el catálogo ya cargado. Trae la lista completa
// una sola vez (igual que PurchaseCatalogPicker) para que el filtrado por
// palabras clave sea 100% del lado del cliente — rápido en celular, sin
// depender de conexión. Gateado por canCaptureMerchandiseReentry (equipo
// de Inventario), no canSubmitPurchaseRequests como el catálogo de compras.
export async function GET() {
  if (!(await canCaptureMerchandiseReentry())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const items = await prisma.purchaseCatalogItem.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, photos: true, justCode: true, pendingRegistration: true },
  });
  return NextResponse.json(items);
}
