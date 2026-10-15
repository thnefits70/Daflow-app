import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { lookupGuide } from "@/lib/localWarranty";
import { arrangementCode, arrangementNotices, getArrangementRole, listArrangements, maxCashSettlement } from "@/lib/warrantyArrangements";

function cleanGuide(s: string) {
  return s.toUpperCase().replace(/\s+/g, "");
}

// GET: la lista + el rol. Con ?guide= busca la guía original (cliente,
// ciudad y productos) para el formulario.
export async function GET(req: NextRequest) {
  const role = await getArrangementRole();
  if (!role) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const guide = req.nextUrl.searchParams.get("guide");
  if (guide) {
    if (!role.canCreate) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    const r = await lookupGuide(cleanGuide(guide));
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 404 });
    const s = r.source;
    return NextResponse.json({
      guide: s.ref,
      clientName: s.clientName,
      city: s.city,
      lines: s.lines.map((l) => ({ catalogItemId: l.catalogItemId, name: l.name, code: l.code, photo: l.photo })),
    });
  }
  return NextResponse.json({ role, rows: await listArrangements(role) });
}

const base = {
  originalGuide: z.string().trim().min(3, "Escribe la guía original.").max(60),
  reason: z.string().trim().min(5, "Escribe el motivo.").max(2000),
  evidenceUrl: z.string().url(),
};
const createSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("RESHIP"),
    ...base,
    orderNumber: z.string().trim().min(2, "Escribe el número de pedido.").max(60),
    freightAmount: z.number().positive("Escribe el valor del flete.").max(100),
    paymentMethod: z.enum(["DROPI_WALLET", "TRANSFER"]),
  }),
  z.object({
    kind: z.literal("CASH"),
    ...base,
    catalogItemId: z.string().min(1, "Elige el producto."),
    amount: z.number().positive("Escribe el monto.").max(500),
    holderName: z.string().trim().min(3, "Escribe el nombre del titular.").max(120),
    holderIdNumber: z.string().trim().min(10, "Escribe la cédula.").max(13),
    bankName: z.string().trim().min(2, "Escribe el banco.").max(80),
    bankAccountType: z.enum(["AHORROS", "CORRIENTE"]),
    bankAccountNumber: z.string().trim().min(4, "Escribe el número de cuenta.").max(30),
  }),
]);

// Solo Michelle y Yair registran.
export async function POST(req: NextRequest) {
  const role = await getArrangementRole();
  if (!role?.canCreate) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  const d = parsed.data;
  const originalGuide = cleanGuide(d.originalGuide);

  const found = await lookupGuide(originalGuide, { productsOnly: d.kind === "RESHIP" });
  if (d.kind === "CASH" && !found.ok) return NextResponse.json({ error: found.error }, { status: 400 });
  const src = found.ok ? found.source : null;

  if (d.kind === "RESHIP") {
    const orderNumber = d.orderNumber.toUpperCase().replace(/\s+/g, "");
    const open = await prisma.warrantyArrangement.findFirst({ where: { kind: "RESHIP", orderNumber, status: { not: "CANCELLED" } }, select: { id: true } });
    if (open) return NextResponse.json({ error: "Ese pedido ya está registrado." }, { status: 400 });
    const row = await prisma.warrantyArrangement.create({
      data: {
        kind: "RESHIP",
        status: "PAYMENT_REVIEW",
        originalGuide,
        clientName: src?.clientName ?? null,
        city: src?.city ?? null,
        reason: d.reason,
        evidenceUrl: d.evidenceUrl,
        orderNumber,
        freightAmount: Math.round(d.freightAmount * 100) / 100,
        paymentMethod: d.paymentMethod,
        createdById: role.userId,
      },
    });
    const code = arrangementCode(row.number);
    await arrangementNotices.paymentSubmitted(code, orderNumber);
    return NextResponse.json({ id: row.id, code }, { status: 201 });
  }

  const line = src!.lines.find((l) => l.catalogItemId === d.catalogItemId);
  if (!line) return NextResponse.json({ error: "Ese producto no está en la guía." }, { status: 400 });
  const max = await maxCashSettlement(d.catalogItemId);
  // Sin mostrar el costo: solo que conviene más hacer la garantía.
  if (d.amount > max) return NextResponse.json({ error: "Ese monto cuesta más que hacer la garantía (2 fletes + producto). Mejor haz la garantía." }, { status: 400 });
  const open = await prisma.warrantyArrangement.findFirst({ where: { kind: "CASH", originalGuide, status: { notIn: ["CANCELLED", "REJECTED"] } }, select: { number: true } });
  if (open) return NextResponse.json({ error: `Esta guía ya tiene un arreglo en dinero (${arrangementCode(open.number)}).` }, { status: 400 });
  const row = await prisma.warrantyArrangement.create({
    data: {
      kind: "CASH",
      status: "APPROVAL",
      originalGuide,
      clientName: src!.clientName,
      city: src!.city,
      reason: d.reason,
      evidenceUrl: d.evidenceUrl,
      catalogItemId: d.catalogItemId,
      productName: line.name,
      amount: Math.round(d.amount * 100) / 100,
      holderName: d.holderName.toUpperCase(),
      holderIdNumber: d.holderIdNumber.replace(/\D/g, ""),
      bankName: d.bankName.toUpperCase(),
      bankAccountType: d.bankAccountType,
      bankAccountNumber: d.bankAccountNumber.replace(/\s+/g, ""),
      createdById: role.userId,
    },
  });
  const code = arrangementCode(row.number);
  await arrangementNotices.cashCreated(code, row.amount!);
  return NextResponse.json({ id: row.id, code }, { status: 201 });
}
