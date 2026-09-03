import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canUploadLowRotationList, canViewComboSuggestions, dbUserId } from "@/lib/guards";
import { generateComboSuggestions } from "@/lib/comboSuggestions";

// Confirmado 2026-08-31: sábado = Daniel sube/actualiza la lista de
// productos que despacharon menos de 8 unidades esa semana.
export async function GET(req: NextRequest) {
  if (!(await canViewComboSuggestions()) && !(await canUploadLowRotationList())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }
  const weekOf = req.nextUrl.searchParams.get("weekOf");
  const entries = await prisma.lowRotationWeeklyEntry.findMany({
    where: weekOf ? { weekOf: new Date(weekOf) } : undefined,
    orderBy: [{ weekOf: "desc" }, { unitsDispatched: "asc" }],
    include: { catalogItem: { select: { id: true, name: true, nicho: true } } },
  });
  return NextResponse.json({ entries });
}

const schema = z.object({
  weekOf: z.string(), // "YYYY-MM-DD", el sábado de esa semana
  entries: z.array(z.object({ catalogItemId: z.string().min(1), unitsDispatched: z.number().int().nonnegative() })),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session || !(await canUploadLowRotationList())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  if (parsed.data.entries.length === 0) return NextResponse.json({ error: "No hay productos para registrar." }, { status: 400 });

  const weekOf = new Date(parsed.data.weekOf);
  await prisma.$transaction(
    parsed.data.entries.map((e) =>
      prisma.lowRotationWeeklyEntry.upsert({
        where: { weekOf_catalogItemId: { weekOf, catalogItemId: e.catalogItemId } },
        update: { unitsDispatched: e.unitsDispatched, createdById: dbUserId(session.user.id) },
        create: { weekOf, catalogItemId: e.catalogItemId, unitsDispatched: e.unitsDispatched, createdById: dbUserId(session.user.id) },
      })
    )
  );

  const { created } = await generateComboSuggestions();
  return NextResponse.json({ ok: true, savedCount: parsed.data.entries.length, suggestionsCreated: created });
}
