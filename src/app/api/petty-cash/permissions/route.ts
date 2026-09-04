import { NextResponse } from "next/server";
import { canManagePettyCashSecundaria } from "@/lib/guards";

// Chequeo liviano para el módulo de Compras: si la persona administra la
// caja chica secundaria (hoy Jariel, o admin), para decidir el valor por
// defecto del flete y si se muestra la opción de deshacer un envío por
// error a la bandeja de Finanzas.
export async function GET() {
  const canSecundaria = await canManagePettyCashSecundaria();
  return NextResponse.json({ canSecundaria });
}
