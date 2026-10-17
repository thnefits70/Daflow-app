import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createPrivatization, emailTrackRecord, getPrivatizationRole, listPrivatizations, lookupPrivatizationProduct, privatizationKpis, PRIVATIZATION_ACCOUNTS } from "@/lib/privatizations";

export const maxDuration = 60;

// Productos privatizados en Dropi (2026-10-17) — ver lib/privatizations.ts.
// GET: lista + KPIs + rol. ?product= busca el producto; ?email= el historial del dropshipper.
export async function GET(req: NextRequest) {
  const role = await getPrivatizationRole();
  if (!role) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const p = req.nextUrl.searchParams;
  const product = p.get("product");
  if (product) return NextResponse.json(await lookupPrivatizationProduct(product));
  const email = p.get("email");
  if (email) return NextResponse.json(await emailTrackRecord(email));
  const rows = await listPrivatizations();
  return NextResponse.json({ role, accounts: PRIVATIZATION_ACCOUNTS, rows, kpis: privatizationKpis(rows) });
}

const schema = z.object({
  account: z.enum(PRIVATIZATION_ACCOUNTS),
  productId: z.string().trim().min(2, "Escribe el ID del producto.").max(40),
  productName: z.string().trim().max(200).nullable().optional(),
  units: z.number().int().positive("Escribe cuántas unidades se privatizan."),
  email: z.string().trim().min(5, "Escribe el correo del dropshipper.").max(200),
  storeName: z.string().trim().min(2, "Escribe el nombre de la tienda como sale en la etiqueta.").max(120),
  phone: z.string().trim().min(7, "Escribe el teléfono del dropshipper.").max(30),
  goalUnits: z.number().int().positive("Escribe la meta de venta."),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Elige la fecha límite del acuerdo."),
  note: z.string().trim().max(1000).nullable().optional(),
});

// Michelle y Yair registran (cada uno en sus cuentas).
export async function POST(req: NextRequest) {
  const role = await getPrivatizationRole();
  if (!role?.accounts.length) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  const d = parsed.data;
  const r = await createPrivatization({ ...d, productName: d.productName ?? null, note: d.note ?? null }, role);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ code: r.code }, { status: 201 });
}
