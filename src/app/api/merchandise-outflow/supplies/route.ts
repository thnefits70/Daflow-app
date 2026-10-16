import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canCaptureMerchandiseOutflow } from "@/lib/guards";
import { formatMerchandiseOutflowCode, nextMerchandiseOutflowNumber } from "@/lib/merchandiseOutflow";
import { getCurrentStock, recordKardexEntry } from "@/lib/stockKardex";

// Pedido de Daniel 2026-10-16: cualquiera de INVESTOCK saca un suministro
// (fundas, film, burbuja…) y lo registra directo — escanea el QR o lo busca,
// pone la cantidad y listo, sin foto ni archivo. Se descuenta del Kardex en
// el momento. Sin montos (equipo INV no ve costos).

async function listSupplies() {
  const items = await prisma.purchaseCatalogItem.findMany({
    where: { bodega: "MKT_SUMINISTROS" },
    orderBy: { name: "asc" },
    select: { id: true, name: true, justCode: true, photos: true },
  });
  const latest = items.length
    ? await prisma.stockKardexEntry.findMany({
        where: { catalogItemId: { in: items.map((i) => i.id) } },
        orderBy: [{ catalogItemId: "asc" }, { occurredAt: "desc" }, { createdAt: "desc" }],
        distinct: ["catalogItemId"],
        select: { catalogItemId: true, balanceAfter: true },
      })
    : [];
  const balance = new Map(latest.map((k) => [k.catalogItemId, k.balanceAfter]));
  return items.map((i) => ({ id: i.id, name: i.name, justCode: i.justCode, photo: i.photos[0] ?? null, stock: balance.get(i.id) ?? 0 }));
}

async function listRecent() {
  const batches = await prisma.merchandiseOutflowBatch.findMany({
    where: { reason: "SUMINISTRO" },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      code: true,
      createdAt: true,
      createdBy: { select: { name: true } },
      items: { select: { declaredName: true, quantity: true, catalogItem: { select: { name: true } } } },
    },
  });
  return batches.map((b) => ({
    code: b.code,
    createdAt: b.createdAt,
    by: b.createdBy?.name ?? null,
    name: b.items[0]?.catalogItem?.name ?? b.items[0]?.declaredName ?? "",
    quantity: b.items[0]?.quantity ?? 0,
  }));
}

export async function GET() {
  if (!(await canCaptureMerchandiseOutflow())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const [supplies, recent] = await Promise.all([listSupplies(), listRecent()]);
  return NextResponse.json({ supplies, recent });
}

const bodySchema = z.object({
  catalogItemId: z.string().min(1),
  quantity: z.number().int("La cantidad debe ser un número entero.").positive("La cantidad debe ser mayor a 0."),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session || !(await canCaptureMerchandiseOutflow())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  const { catalogItemId, quantity } = parsed.data;

  const item = await prisma.purchaseCatalogItem.findUnique({ where: { id: catalogItemId }, select: { id: true, name: true, bodega: true } });
  if (!item || item.bodega !== "MKT_SUMINISTROS") return NextResponse.json({ error: "Ese producto no es un suministro." }, { status: 400 });

  const batchNumber = await nextMerchandiseOutflowNumber();
  const now = new Date();
  const batch = await prisma.merchandiseOutflowBatch.create({
    data: {
      code: formatMerchandiseOutflowCode(batchNumber),
      batchNumber,
      reason: "SUMINISTRO",
      createdById: session.user.id,
      submittedAt: now,
      items: { create: [{ catalogItemId: item.id, declaredName: item.name, quantity }] },
    },
    include: { items: { select: { id: true } } },
  });

  await recordKardexEntry({
    catalogItemId: item.id,
    type: "OUT",
    quantity,
    unitCost: null,
    occurredAt: now,
    merchandiseOutflowItemId: batch.items[0].id,
  }).catch((err) => console.error("[supplies outflow] No se pudo registrar la salida de Kardex:", err));

  const { balance } = await getCurrentStock(item.id);
  return NextResponse.json({ code: batch.code, name: item.name, quantity, stock: balance });
}
