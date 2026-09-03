import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canApproveComboSuggestions } from "@/lib/guards";

// Confirmado 2026-09-03: pedido explícito del usuario — al agregar el filtro
// de IA por lógica real de combo (ver comboSuggestions.ts), las
// sugerencias que ya se habían creado ANTES de ese filtro (puro cruce por
// nicho, sin revisar sentido real) se quedan como ruido — el cruce nunca
// re-evalúa una pareja que ya existe como ComboSuggestion. Este botón borra
// las que todavía están en "SUGERIDO" (nadie las seleccionó ni mandó a
// aprobación todavía) para que el próximo recálculo arranque limpio con el
// filtro nuevo. Nunca toca SELECCIONADO/PENDIENTE_APROBACION/APROBADO/
// CREADO_EN_DROPI — esas ya tienen una decisión real de alguien detrás.
export async function POST() {
  if (!(await canApproveComboSuggestions())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const result = await prisma.comboSuggestion.deleteMany({ where: { status: "SUGERIDO" } });
  return NextResponse.json({ deleted: result.count });
}
