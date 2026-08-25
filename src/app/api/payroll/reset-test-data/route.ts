import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/guards";

const CONFIRM_PHRASE = "BORRAR DATOS DE PRUEBA";

const schema = z.object({ confirm: z.string() });

// Confirmado 2026-08-25: tercera pasada — además de anticipos y descuentos,
// también las cuentas bancarias que los colaboradores cargaron probando el
// flujo de anticipos (Nómina sigue pre-lanzamiento: PayrollPeriod/LineItem/
// Transfer están en cero, no hay ningún rol real corrido todavía). Mismo
// criterio de siempre: ruta admin-only con frase de confirmación en vez de
// un script directo a la base (ver feedback_prod_db_script_writes_blocked),
// archivo temporal, se borra después de usarlo una vez.
export async function POST(req: NextRequest) {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  if (parsed.data.confirm !== CONFIRM_PHRASE) {
    return NextResponse.json({ error: `Frase de confirmación incorrecta. Debe ser exactamente: "${CONFIRM_PHRASE}"` }, { status: 400 });
  }

  const result = await prisma.$transaction(async (tx) => {
    const advances = await tx.salaryAdvance.deleteMany({});
    const deductions = await tx.managementDeduction.deleteMany({});
    const bankAccounts = await tx.employeeBankAccount.deleteMany({});
    return { advances: advances.count, deductions: deductions.count, bankAccounts: bankAccounts.count };
  });

  return NextResponse.json(result);
}
