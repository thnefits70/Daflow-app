import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canManageInventoryControl } from "@/lib/guards";
import { getFinanzasDeptId } from "@/lib/inventoryKpis";
import { currentQuarter } from "@/lib/inventoryKpisCalc";
import { prisma } from "@/lib/prisma";

const schema = z.object({ name: z.string().trim().min(1), value: z.number().nonnegative() });

// Daniel agrega un producto que recién cruzó los 3 meses sin venderse —
// confirmado 2026-08-04: arranca en quartersConfirmed=1 (bucket "3-6 meses")
// y el trimestre actual como lastConfirmedQuarter. Nunca se elimina, solo se
// recupera o se reconfirma.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!(await canManageInventoryControl()) || !session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const deptId = await getFinanzasDeptId();
  if (!deptId) return NextResponse.json({ error: "No se encontró el departamento de Finanzas." }, { status: 500 });

  const product = await prisma.inventoryStaleProduct.create({
    data: {
      deptId,
      name: parsed.data.name,
      value: parsed.data.value,
      lastConfirmedQuarter: currentQuarter(),
      quartersConfirmed: 1,
      createdById: session.user.role === "admin" ? null : session.user.id,
      updatedById: session.user.role === "admin" ? null : session.user.id,
    },
  });

  return NextResponse.json({ ok: true, product });
}
