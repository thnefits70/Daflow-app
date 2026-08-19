import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { resolveFirstPayoutMonth } from "@/lib/payroll";
import { notifyOwner } from "@/lib/notifications";
import { actorName } from "@/lib/actorName";

// Confirmado 2026-08-18: la aceptación del colaborador afectado es lo que
// activa el descuento real — queda como constancia (acceptedAt). Mientras
// no acepte, nunca se aplica a ningún rol.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || session.user.role === "admin") return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const { id } = await params;
  const deduction = await prisma.managementDeduction.findUnique({ where: { id } });
  if (!deduction) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (deduction.employeeId !== session.user.id) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  if (deduction.acceptedAt) return NextResponse.json({ error: "Ya lo habías aceptado." }, { status: 409 });

  const firstPayoutMonth = await resolveFirstPayoutMonth(deduction.startMonth);
  const updated = await prisma.managementDeduction.update({
    where: { id },
    data: { acceptedAt: new Date(), firstPayoutMonth },
  });

  await notifyOwner("admin", {
    title: "✅ Descuento aceptado",
    body: `${actorName(session.user.name)} aceptó el descuento de $${deduction.totalAmount.toFixed(2)}.`,
    url: "/admin/nomina?tab=pagos&ptab=descuentos",
  }).catch(() => null);

  return NextResponse.json(updated);
}
