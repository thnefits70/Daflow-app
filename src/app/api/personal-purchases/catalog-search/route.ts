import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// Confirmado 2026-08-27 (pedido de Daniel vía el usuario): Compras
// Personales era el único flujo de la app donde el colaborador escribía el
// nombre del producto de memoria en vez de elegirlo del catálogo ya
// sincronizado con Just (el mismo que usan Reingreso, Registro de Egresos,
// Ventas Externas y Guías Canceladas) — eso obligaba a Daniel a corregir a
// mano el nombre de cada producto de cada pedido. Guard propio (no
// canCaptureMerchandiseReentry, que es solo Inventario) porque cualquier
// colaborador puede comprar personal, igual que puede crear el pedido en
// POST /api/personal-purchases.
export async function GET() {
  const session = await auth();
  if (!session || session.user.role === "admin") return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const items = await prisma.purchaseCatalogItem.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, photos: true, justCode: true, pendingRegistration: true },
  });
  return NextResponse.json(items);
}
