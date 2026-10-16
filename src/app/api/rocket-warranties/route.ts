import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ROCKET_WARRANTY_REASONS, createRocketWarranty, getRocketWarrantyRole, linkRocketWarrantyGuides, listRocketWarranties, lookupRocketGuide } from "@/lib/rocketWarranty";

// Garantías de Rocket por orden de Dropi (2026-10-16) — ver lib/rocketWarranty.ts.
// GET: lista + rol + motivos. Con ?guide= busca la guía de Rocket original.
export async function GET(req: NextRequest) {
  const role = await getRocketWarrantyRole();
  if (!role) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const guide = req.nextUrl.searchParams.get("guide");
  if (guide) {
    if (!role.canCreate) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    const r = await lookupRocketGuide(guide);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 404 });
    return NextResponse.json(r);
  }
  // Al abrir la pantalla, NICK busca las guías que falten (sin demorar mucho).
  await linkRocketWarrantyGuides({ budgetMs: 8_000 }).catch(() => 0);
  // Solo los 4 motivos normales (con el nombre exacto que tienen en el KPI).
  const existing = (await prisma.warrantyCategory.findMany({ select: { name: true } })).map((c) => c.name);
  const reasons = ROCKET_WARRANTY_REASONS.map((r) => existing.find((e) => e.toLowerCase() === r.toLowerCase())).filter((r): r is string => !!r);
  return NextResponse.json({ role, reasons, rows: await listRocketWarranties() });
}

const schema = z.object({
  originalGuide: z.string().trim().min(5, "Escribe la guía de Rocket original.").max(60),
  items: z.array(z.object({ catalogItemId: z.string().min(1), quantity: z.number().int().positive() })).min(1, "Elige al menos un producto.").max(30),
  reason: z.string().trim().min(1, "Elige el motivo.").max(80),
  note: z.string().trim().max(1000).nullable().optional(),
  evidenceUrls: z.array(z.string().url()).max(6).optional(),
  dropiOrder: z.string().trim().min(3, "Escribe el número de orden de Dropi.").max(40),
});

// Solo Yair registra (garantías de Rocket).
export async function POST(req: NextRequest) {
  const role = await getRocketWarrantyRole();
  if (!role?.canCreate) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  const d = parsed.data;
  const r = await createRocketWarranty({ ...d, note: d.note ?? null, evidenceUrls: d.evidenceUrls ?? [] }, role.userId);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  // Por si Dropi ya generó la guía de esa orden.
  await linkRocketWarrantyGuides({ budgetMs: 8_000, force: true }).catch(() => 0);
  return NextResponse.json({ id: r.id, code: r.code }, { status: 201 });
}
