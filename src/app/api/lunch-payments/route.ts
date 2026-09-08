import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canRegisterLunchPayments } from "@/lib/guards";
import { getLunchPaymentSettings, getLunchDefaults } from "@/lib/lunchPayments";
import { getAdminPaymentPayees } from "@/lib/adminPayments";
import { sendPushToOwner } from "@/lib/webPush";

export async function GET() {
  if (!(await canRegisterLunchPayments())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const session = await auth();
  const [settings, defaults, payees, history] = await Promise.all([
    getLunchPaymentSettings(),
    getLunchDefaults(),
    getAdminPaymentPayees(),
    prisma.adminPaymentRequest.findMany({
      where: { lunchWeekStart: { not: null }, createdById: session!.user.role === "admin" ? undefined : session!.user.id },
      orderBy: { lunchWeekStart: "desc" },
      take: 12,
      select: { id: true, motivo: true, monto: true, status: true, lunchWeekStart: true, lunchWeekEnd: true, lunchCount: true, createdAt: true },
    }),
  ]);

  return NextResponse.json({ settings, defaults, payees, history });
}

const schema = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weekEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lunchCount: z.number().int().positive(),
  // Opcional: el monto real de la factura puede diferir por unos centavos del
  // cálculo simple (cantidad × precio) porque el restaurante ajusta el
  // precio unitario para que, con el IVA, cuadre en $2.50 por almuerzo — esa
  // compensación puede arrastrar centavos al total según la cantidad. Si no
  // se manda, se usa el cálculo simple.
  monto: z.number().positive().optional(),
  payeeId: z.string().optional(),
  bankAccountId: z.string().optional(),
  declarationFileUrl: z.string().url().optional(),
  declarationFileName: z.string().optional(),
});

const MONTH_NAMES_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
function formatDateEs(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} de ${MONTH_NAMES_ES[m - 1]} del ${y}`;
}

export async function POST(req: NextRequest) {
  if (!(await canRegisterLunchPayments())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const session = await auth();
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  const d = parsed.data;

  const weekStart = new Date(`${d.weekStart}T00:00:00.000Z`);
  const weekEnd = new Date(`${d.weekEnd}T00:00:00.000Z`);
  if (weekEnd < weekStart) return NextResponse.json({ error: "La fecha final no puede ser antes de la inicial." }, { status: 400 });

  const existing = await prisma.adminPaymentRequest.findFirst({ where: { lunchWeekStart: weekStart, lunchWeekEnd: weekEnd } });
  if (existing) return NextResponse.json({ error: "Ya existe una solicitud registrada para esa misma semana." }, { status: 409 });

  const { pricePerLunch } = await getLunchPaymentSettings();
  const computedMonto = Math.round(d.lunchCount * pricePerLunch * 100) / 100;
  // Tolerancia: hasta $2 o 5% de diferencia contra el cálculo simple (para
  // absorber el redondeo real de la factura) — más que eso probablemente es
  // un error de tipeo, así que se rechaza.
  if (d.monto !== undefined && Math.abs(d.monto - computedMonto) > Math.max(2, computedMonto * 0.05)) {
    return NextResponse.json({ error: `El monto ($${d.monto.toFixed(2)}) está muy lejos del cálculo esperado ($${computedMonto.toFixed(2)} = ${d.lunchCount} × $${pricePerLunch.toFixed(2)}). Revisa la cantidad o el monto.` }, { status: 400 });
  }
  const monto = d.monto ?? computedMonto;
  const motivo = `Almuerzos semana del ${formatDateEs(d.weekStart)} al ${formatDateEs(d.weekEnd)} — ${d.lunchCount} almuerzos x $${pricePerLunch.toFixed(2)}`;

  const isAdmin = session!.user.role === "admin";
  const created = await prisma.adminPaymentRequest.create({
    data: {
      type: "VARIABLE",
      motivo,
      monto,
      payeeId: d.payeeId || null,
      bankAccountId: d.bankAccountId || null,
      declarationFileUrl: d.declarationFileUrl ?? null,
      declarationFileName: d.declarationFileName ?? null,
      lunchWeekStart: weekStart,
      lunchWeekEnd: weekEnd,
      lunchCount: d.lunchCount,
      createdById: isAdmin ? null : session!.user.id,
    },
  });

  await sendPushToOwner("admin", {
    title: "🍽️ Nueva solicitud de pago — Almuerzos",
    body: `${motivo} — $${monto.toFixed(2)}`,
    url: "/admin",
  }).catch(() => null);

  return NextResponse.json(created, { status: 201 });
}
