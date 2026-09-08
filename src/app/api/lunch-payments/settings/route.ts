import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canManageAdminPayments, canRegisterLunchPayments } from "@/lib/guards";
import { getLunchPaymentSettings, updateLunchPricePerLunch } from "@/lib/lunchPayments";

export async function GET() {
  if (!(await canManageAdminPayments()) && !(await canRegisterLunchPayments())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }
  return NextResponse.json(await getLunchPaymentSettings());
}

const schema = z.object({ pricePerLunch: z.number().positive() });

// Confirmado 2026-09-08: solo quien gestiona Pagos administrativos (Finanzas
// + admin) puede cambiar la tarifa — Daniel solo cuenta almuerzos, no decide
// el precio del convenio con el restaurante.
export async function PATCH(req: NextRequest) {
  if (!(await canManageAdminPayments())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const session = await auth();
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const isAdmin = session?.user.role === "admin";
  const updated = await updateLunchPricePerLunch(parsed.data.pricePerLunch, isAdmin ? null : session!.user.id);
  return NextResponse.json(updated);
}
