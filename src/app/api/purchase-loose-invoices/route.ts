import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canActOnPurchaseInvoices, canRegisterPurchaseInvoices } from "@/lib/guards";

// Confirmado 2026-10-07, pedido de Nairoby: facturas sin compra específica
// (ver LooseInvoice en schema.prisma). Mismo permiso que "Registrar
// factura": admin ve, solo Nairoby (líder de Finanzas) sube y quita.
export async function GET(req: NextRequest) {
  if (!(await canRegisterPurchaseInvoices())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  // Operaciones ya pagadas de un proveedor, para enlazar la compra anterior.
  const operationsFor = req.nextUrl.searchParams.get("operationsFor");
  if (operationsFor) {
    const rows = await prisma.purchaseRequest.findMany({
      where: { supplierId: operationsFor, paidAt: { not: null } },
      orderBy: { paidAt: "desc" },
      select: { groupId: true, requestNumber: true, paidAt: true, totalCost: true, catalogItem: { select: { name: true } } },
      take: 300,
    });
    const groups = new Map<string, { groupId: string; requestNumber: number | null; paidAt: string | null; total: number; products: string[] }>();
    for (const r of rows) {
      const g = groups.get(r.groupId) ?? { groupId: r.groupId, requestNumber: r.requestNumber, paidAt: r.paidAt?.toISOString() ?? null, total: 0, products: [] };
      g.total += r.totalCost;
      g.products.push(r.catalogItem.name);
      groups.set(r.groupId, g);
    }
    return NextResponse.json([...groups.values()].slice(0, 60));
  }

  const [invoices, suppliers] = await Promise.all([
    prisma.looseInvoice.findMany({
      where: { deletedAt: null },
      orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
      include: { supplier: { select: { id: true, name: true } }, createdBy: { select: { name: true } } },
    }),
    prisma.supplier.findMany({
      where: { type: "SUPPLIER", status: "APPROVED" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const groupIds = [...new Set(invoices.map((i) => i.relatedGroupId).filter((g): g is string => !!g))];
  const related = groupIds.length
    ? await prisma.purchaseRequest.findMany({
        where: { groupId: { in: groupIds } },
        select: { groupId: true, requestNumber: true, paidAt: true, catalogItem: { select: { name: true } } },
      })
    : [];
  const relatedMap = new Map<string, { requestNumber: number | null; paidAt: string | null; products: string[] }>();
  for (const r of related) {
    const g = relatedMap.get(r.groupId) ?? { requestNumber: r.requestNumber, paidAt: r.paidAt?.toISOString() ?? null, products: [] };
    g.products.push(r.catalogItem.name);
    relatedMap.set(r.groupId, g);
  }

  return NextResponse.json({
    invoices: invoices.map((i) => ({ ...i, related: i.relatedGroupId ? relatedMap.get(i.relatedGroupId) ?? null : null })),
    suppliers,
  });
}

const schema = z.object({
  supplierId: z.string().min(1, "Elige el proveedor."),
  invoiceNumber: z.string().trim().max(60).optional().nullable(),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pon la fecha de la factura."),
  amount: z.number().positive("El monto debe ser mayor a 0."),
  docUrl: z.string().url("Sube la factura."),
  reason: z.enum(["PREVIOUS_PURCHASE", "GENERAL_SUPPORT", "OTHER"]),
  relatedGroupId: z.string().optional().nullable(),
  note: z.string().trim().max(1000).optional().nullable(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!(await canActOnPurchaseInvoices()) || !session) return NextResponse.json({ error: "Exclusivo de Nairoby (líder de Finanzas)." }, { status: 403 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  const d = parsed.data;
  if (d.reason === "OTHER" && !d.note) return NextResponse.json({ error: "Escribe una nota explicando la factura." }, { status: 400 });

  const supplier = await prisma.supplier.findUnique({ where: { id: d.supplierId }, select: { id: true } });
  if (!supplier) return NextResponse.json({ error: "Proveedor no encontrado." }, { status: 404 });
  const relatedGroupId = d.reason === "PREVIOUS_PURCHASE" && d.relatedGroupId ? d.relatedGroupId : null;
  if (relatedGroupId) {
    const op = await prisma.purchaseRequest.findFirst({ where: { groupId: relatedGroupId, supplierId: d.supplierId }, select: { id: true } });
    if (!op) return NextResponse.json({ error: "Esa compra no es de este proveedor." }, { status: 400 });
  }

  const created = await prisma.looseInvoice.create({
    data: {
      supplierId: d.supplierId,
      invoiceNumber: d.invoiceNumber || null,
      // Mediodía UTC para que la fecha no se corra un día en Ecuador (UTC-5).
      invoiceDate: new Date(`${d.invoiceDate}T12:00:00Z`),
      amount: d.amount,
      docUrl: d.docUrl,
      reason: d.reason,
      relatedGroupId,
      note: d.note || null,
      createdById: session.user.id,
    },
  });
  return NextResponse.json(created);
}
