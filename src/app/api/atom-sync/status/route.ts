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
    prisma.atomProductStatus.findFirst({ orderBy: { capturedAt: "desc" }, select: { capturedAt: true, createdByName: true } }),
  ]);
  // Confirmado 2026-09-03: pedido explícito del usuario — la pantalla de
  // "Actualizar ATOM" no dejaba rastro visible de una lectura ya guardada
  // (la caja de texto vuelve a estar vacía en cada visita), así que después
  // de guardar parecía que nada había quedado. lastSyncCount cuenta cuántos
  // productos comparten el capturedAt más reciente (una lectura = un
  // capturedAt fijo, ver applyAtomSync en atomSync.ts).
  const lastSyncCount = latest ? await prisma.atomProductStatus.count({ where: { capturedAt: latest.capturedAt } }) : null;
  return NextResponse.json({ dueToday, lastSyncAt: latest?.capturedAt ?? null, lastSyncCount, lastSyncByName: latest?.createdByName ?? null });
}
