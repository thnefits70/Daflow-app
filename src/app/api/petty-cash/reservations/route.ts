import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canManagePettyCashPrincipal, canManagePettyCashSecundaria } from "@/lib/guards";
import { getOrCreateBox } from "@/lib/pettyCash";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  boxType: z.enum(["PRINCIPAL", "SECUNDARIA"]),
  amount: z.number().positive(),
  description: z.string().trim().min(1),
});

// Pedido del usuario 2026-10-05: apartar dinero de la caja para un gasto
// que ya está comprometido pero todavía no se paga (caso Nairoby: $555
// para una compra de Marcos). Igual que un desembolso, es exclusivo de
// quien administra la caja día a día — admin solo lo ve. Se permite apartar
// más de lo que hay: así el saldo libre queda negativo y el aviso de saldo
// bajo le pide al dueño que fondee.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  if (session.user.role === "admin") return NextResponse.json({ error: "Apartar dinero lo hace quien administra la caja." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Escribe para qué es y un monto válido." }, { status: 400 });
  const d = parsed.data;

  const authorized = d.boxType === "PRINCIPAL" ? await canManagePettyCashPrincipal() : await canManagePettyCashSecundaria();
  if (!authorized) return NextResponse.json({ error: "No autorizado para esta caja." }, { status: 403 });

  const box = await getOrCreateBox(d.boxType);
  const reservation = await prisma.pettyCashReservation.create({
    data: { boxId: box.id, amount: d.amount, description: d.description, createdById: session.user.id },
  });
  return NextResponse.json({ ok: true, reservation });
}
