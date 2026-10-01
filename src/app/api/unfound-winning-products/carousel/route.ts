import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canProposeMarketProduct, canDeclareExternalSales } from "@/lib/guards";

// Confirmado 2026-09-23, pedido explícito del usuario: el carrusel de
// "Ganadores no encontrados" de Inicio lo ven, tal cual lo ve Jariel, todo
// Análisis de Mercado (Bryan, Heidy, Robert, Jariel), los asesores de
// Ventas Externas (Marcos, Yair — permiso canDeclareExternalSales) y admin.
// Hasta 2026-10-01 también entraba el líder de Fulfillment; esa área se
// fusionó en INVESTOCK y Yair pasó a ser asesor. Solo lectura: devuelve solo lo que se muestra (imagen, nombre,
// precio de la competencia) de los que siguen buscando proveedor — nunca
// proveedor, notas ni quién lo registró. `listUrl` es a dónde lleva cada
// tarjeta; null para quien no puede abrir la lista completa (Marcos/Yair),
// así la tarjeta no lleva a una pestaña que no tiene.
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const [canOpenList, isSalesAdvisor] = await Promise.all([canProposeMarketProduct(), canDeclareExternalSales()]);
  if (!canOpenList && !isSalesAdvisor) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const items = await prisma.unfoundWinningProduct.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "desc" },
    select: { id: true, productName: true, imageUrl: true, competitorPrice: true },
  });

  let listUrl: string | null = null;
  if (canOpenList) {
    if (session.user.role === "admin") {
      const mkt = await prisma.department.findFirst({ where: { code: "MKT" }, select: { id: true } });
      listUrl = mkt ? `/admin/dept/${mkt.id}?tab=analisis-mercado&ptab=ganadores` : null;
    } else {
      listUrl = "/area/workspace?tab=analisis-mercado&ptab=ganadores";
    }
  }

  return NextResponse.json({ items, listUrl });
}
