import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { canManagePettyCashPrincipal, canManagePettyCashSecundaria } from "@/lib/guards";
import { getOrCreateBox } from "@/lib/pettyCash";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  boxType: z.enum(["PRINCIPAL", "SECUNDARIA"]),
  payoutAccount: z.string().trim().min(1).max(200).nullable(),
});

// Confirmado 2026-08-19: solo quien de verdad administra la caja día a día
// (nunca admin, que es quien transfiere) puede fijar a qué cuenta quiere
// que se le fondee — así el dueño sabe a dónde transferir sin adivinar.
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  if (session.user.role === "admin") {
    return NextResponse.json({ error: "Solo quien administra la caja puede fijar su cuenta de destino." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  const d = parsed.data;

  const authorized = d.boxType === "PRINCIPAL" ? await canManagePettyCashPrincipal() : await canManagePettyCashSecundaria();
  if (!authorized) return NextResponse.json({ error: "No autorizado para esta caja." }, { status: 403 });

  const box = await getOrCreateBox(d.boxType);
  const updated = await prisma.pettyCashBox.update({
    where: { id: box.id },
    data: { payoutAccount: d.payoutAccount },
  });

  return NextResponse.json({ ok: true, payoutAccount: updated.payoutAccount });
}
