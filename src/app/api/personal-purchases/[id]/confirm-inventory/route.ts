import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canConfirmPersonalPurchaseInventory } from "@/lib/guards";
import { computeUnitPriceModes, type UnitDeclaration } from "@/lib/personalPurchases";
import { sendPushToOwner } from "@/lib/webPush";
import { notifyOwner } from "@/lib/notifications";
import { actorName } from "@/lib/actorName";

const schema = z.object({
  items: z.array(z.object({ itemId: z.string().min(1), confirmedProductName: z.string().trim().min(1) })).min(1),
});

// Confirmado 2026-08-18/20: la confirmación de Daniel es el momento en que
// se corrige el nombre de cada producto según JUST — recién con ese nombre
// confiable se puede calcular qué unidades califican a precio al costo
// (enfriamiento de 6 meses). Esto YA NO habilita el retiro físico (eso lo
// hace mark-picked-up, cuando Daniel de verdad observa y aprueba el
// producto que se lleva el colaborador) — acá es solo un trámite de
// escritorio. A Andrés le llega solo un aviso informativo (campanita); a
// Nairoby le llega como pendiente de acción (ella tiene que fijar el precio).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canConfirmPersonalPurchaseInventory())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const session = await auth();
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const order = await prisma.personalPurchaseOrder.findUnique({
    where: { id },
    include: { employee: { select: { id: true, name: true } }, items: true },
  });
  if (!order) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (order.status !== "PENDING_INVENTORY") return NextResponse.json({ error: "Ya fue procesado." }, { status: 409 });

  const nameById = new Map(parsed.data.items.map((i) => [i.itemId, i.confirmedProductName]));
  for (const it of order.items) {
    if (!nameById.has(it.id)) return NextResponse.json({ error: "Falta confirmar el nombre de todos los productos." }, { status: 400 });
  }

  for (const it of order.items) {
    const confirmedProductName = nameById.get(it.id)!;
    const declarations = (Array.isArray(it.unitDeclarations) ? it.unitDeclarations : []) as unknown as UnitDeclaration[];
    const unitPriceModes = await computeUnitPriceModes(order.employeeId, confirmedProductName, it.quantity, declarations);
    await prisma.personalPurchaseItem.update({
      where: { id: it.id },
      data: { confirmedProductName, unitPriceModes },
    });
  }

  const isAdmin = session!.user.role === "admin";
  const updated = await prisma.personalPurchaseOrder.update({
    where: { id },
    data: { status: "PENDING_FINANCE", inventoryConfirmedAt: new Date(), inventoryConfirmedById: isAdmin ? null : session!.user.id },
  });

  const itemCount = order.items.length;
  await notifyOwner("admin", {
    title: "🛒 Compra personal confirmada por bodega",
    body: `${order.employee.name} · ${itemCount} producto${itemCount === 1 ? "" : "s"} · confirmado por ${actorName(isAdmin ? null : session!.user.name)}`,
    url: "/area/nomina?tab=pagos&ptab=comprasfinanzas",
  });

  const finLeader = await prisma.user.findFirst({ where: { isLeader: true, leadsDept: { code: "FIN" } }, select: { id: true } });
  if (finLeader) {
    await sendPushToOwner(finLeader.id, {
      title: "🛒 Compra personal lista para fijar precio",
      body: `${order.employee.name} · ${itemCount} producto${itemCount === 1 ? "" : "s"}`,
      url: "/area/nomina?tab=pagos&ptab=comprasfinanzas",
    }).catch(() => null);
  }

  await sendPushToOwner(order.employee.id, {
    title: "🛒 Tu compra personal fue confirmada",
    body: "Daniel te avisa cuando esté lista para retirar.",
    url: "/area/compras-personales",
  }).catch(() => null);

  return NextResponse.json(updated);
}
