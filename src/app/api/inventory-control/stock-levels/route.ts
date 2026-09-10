import { NextResponse } from "next/server";
import { canManageJustCatalog } from "@/lib/guards";
import { getAllCurrentStock } from "@/lib/stockKardex";

// Confirmado 2026-09-10 (pedido explícito del usuario): pantalla "Stock
// actual" — mismo permiso que "Etiquetas de percha" (Daniel, líder de
// Inventario, + admin), para que ambos vean el saldo de INVESTOCK de todos
// los productos en cualquier momento, sin depender de la subida semanal de
// Just.
export async function GET() {
  if (!(await canManageJustCatalog())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const rows = await getAllCurrentStock();
  return NextResponse.json(rows);
}
