import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canSetMissingComboBrand } from "@/lib/comboAlias";

// Pedido del usuario 2026-10-10: la receta de un combo se registra una sola
// vez (con doble confirmación) y después solo el admin puede corregirla o
// borrar el combo (canEdit). La marca que falta (combo que vino en un PDF
// "SinMarca") la elige la asesora B2B (canSetMissingBrand). Las pantallas
// preguntan aquí qué botones muestran.
export async function GET() {
  const session = await auth();
  return NextResponse.json({ canEdit: session?.user.role === "admin", canSetMissingBrand: await canSetMissingComboBrand() });
}
