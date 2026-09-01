import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canViewComboSuggestions } from "@/lib/guards";
import { isAtomSyncDueToday } from "@/lib/atomReminder";

// Usado por la pantalla de Sugerencias de Combos para mostrar el aviso de
// "datos desactualizados" y bloquear solo la generación de nuevas
// sugerencias hasta que se registre el sync del día — nunca bloquea el
// resto de DAFLOW.
export async function GET() {
  if (!(await canViewComboSuggestions())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const [dueToday, latest] = await Promise.all([
    isAtomSyncDueToday(),
    prisma.atomProductStatus.findFirst({ orderBy: { capturedAt: "desc" }, select: { capturedAt: true } }),
  ]);
  return NextResponse.json({ dueToday, lastSyncAt: latest?.capturedAt ?? null });
}
