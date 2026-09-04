import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canViewComboSuggestions } from "@/lib/guards";
import { generateComboSuggestions } from "@/lib/comboSuggestions";

// Confirmado 2026-09-03: el cruce corre varias llamadas de IA en paralelo
// (ver filterPlausibleComboPairs) que en conjunto pueden tardar más que el
// límite por defecto de una función serverless.
export const maxDuration = 60;

// Confirmado 2026-09-03: pedido explícito del usuario — antes el cruce solo
// corría automáticamente al guardar una lectura de ATOM o baja rotación
// manual. Con el cruce automático contra el Excel semanal de stock (ver
// comboSuggestions.ts), puede haber datos nuevos con qué cruzar sin que
// nadie haga ninguna de esas dos acciones — este botón deja recalcular en el
// momento sin esperar a la próxima.
export async function POST() {
  const session = await auth();
  if (!session || !(await canViewComboSuggestions())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const result = await generateComboSuggestions(session.user.id);
  return NextResponse.json(result);
}
