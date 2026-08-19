import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { nowInEcuador } from "@/lib/payrollCalc";
import { sendPushToOwner } from "@/lib/webPush";
import { actorName } from "@/lib/actorName";

function currentMonthStr(): string {
  const d = nowInEcuador();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Historial propio del colaborador. Confirmado 2026-08-18: el total solo
// se manda una vez APPROVED (ya es lo mismo que le llegó por push al
// cerrar Nairoby el precio) — antes de eso ningún monto existe todavía.
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  if (session.user.role === "admin") return NextResponse.json([]);

  const orders = await prisma.personalPurchaseOrder.findMany({
    where: { employeeId: session.user.id },
    select: {
      id: true,
      status: true,
      rejectionReason: true,
      totalAmount: true,
      installments: true,
      createdAt: true,
      items: { select: { employeeProductName: true, confirmedProductName: true, quantity: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(orders);
}

const declarationSchema = z.object({
  relation: z.enum(["SELF", "MINOR_CHILD", "OTHER_FAMILY"]),
  note: z.string().trim().optional(),
});
const itemSchema = z.object({
  employeeProductName: z.string().trim().min(1),
  quantity: z.number().int().positive(),
  livePhotoUrl: z.string().min(1),
  optionalPhotoUrl: z.string().optional(),
  unitDeclarations: z.array(declarationSchema).max(3),
});
const schema = z.object({ items: z.array(itemSchema).min(1) });

// Confirmado 2026-08-18: rediseño completo — el colaborador ya no elige de
// un catálogo, escribe el nombre de memoria (Daniel lo corrige después) y
// declara, por cada producto, hasta 3 unidades y para quién es cada una.
// No se calcula ningún precio acá — eso pasa recién al confirmar Daniel
// (necesita el nombre ya corregido para el enfriamiento de 6 meses).
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session || session.user.role === "admin") return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  for (const it of parsed.data.items) {
    if (it.unitDeclarations.length > it.quantity) {
      return NextResponse.json({ error: "No podés declarar más unidades de las que estás llevando." }, { status: 400 });
    }
    for (const d of it.unitDeclarations) {
      if (d.relation !== "SELF" && !d.note) {
        return NextResponse.json({ error: "Contá para quién es cada unidad que no sea para vos." }, { status: 400 });
      }
    }
  }

  const order = await prisma.personalPurchaseOrder.create({
    data: {
      employeeId: session.user.id,
      eventMonth: currentMonthStr(),
      items: {
        create: parsed.data.items.map((it) => ({
          employeeProductName: it.employeeProductName,
          quantity: it.quantity,
          livePhotoUrl: it.livePhotoUrl,
          optionalPhotoUrl: it.optionalPhotoUrl,
          unitDeclarations: it.unitDeclarations,
        })),
      },
    },
    include: { items: true },
  });

  const invLeader = await prisma.user.findFirst({ where: { isLeader: true, leadsDept: { code: "INV" } }, select: { id: true } });
  if (invLeader) {
    await sendPushToOwner(invLeader.id, {
      title: "🛒 Nuevo pedido de compra personal — falta confirmar",
      body: `${actorName(session.user.name)} · ${order.items.length} producto${order.items.length === 1 ? "" : "s"}`,
      url: "/area/compras-personales-inventario",
    }).catch(() => null);
  }

  return NextResponse.json(order, { status: 201 });
}
