import { prisma } from "@/lib/prisma";
import { productValues } from "@/lib/nick/score";

// NICK — cruce de pagos (aprobado 2026-10-16, por ahora SOLO el admin).
// Por cuenta y mes de CREACIÓN de la orden (hora Ecuador): cruza las guías que
// NICK ve en Dropi con los pagos del Historial de cartera subido, por número
// de guía y en cualquier archivo subido (una guía de fin de mes puede pagarse
// el mes siguiente).

export type PaymentGuide = {
  guideNumber: string;
  orderId: string;
  status: string;
  carrier: string | null;
  city: string | null;
  orderDay: string | null;
  paid: number; // suma de pagos encontrados
  payments: number; // cuántos pagos
  estValue: number | null; // lo que debería pagar Dropi (precio del catálogo)
};

export type NickPayments = {
  accounts: { id: string; name: string }[];
  uploads: { id: string; accountId: string; month: string; fileName: string; rows: number; skipped: number; createdAt: string }[];
  months: string[];
  account: string | null;
  month: string | null;
  // deliveredWaiting: entregadas sin pago cuyo pago probablemente está en el
  // archivo del mes siguiente (Dropi paga ~4 días después, hasta ~9).
  counts: { delivered: number; deliveredPaid: number; deliveredUnpaid: number; deliveredWaiting: number; paidTwice: number; paidReturned: number; paidNotInNick: number };
  amounts: { paid: number; unpaidEstimate: number; indemnIn: number; indemnOut: number; warrantyCharges: number; rejected: number };
  unpaid: PaymentGuide[];
  paidTwice: PaymentGuide[];
  paidReturned: PaymentGuide[];
  indemnities: { at: string; direction: string; amount: number; orderId: string | null; guideNumber: string | null; description: string }[];
};

const ecDay = (d: Date) => new Date(d.getTime() - 5 * 3600e3).toISOString().slice(0, 10);
const monthRange = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  // 00:00 hora Ecuador = 05:00 UTC
  return { from: new Date(Date.UTC(y, mo - 1, 1, 5)), to: new Date(Date.UTC(y, mo, 1, 5)) };
};
const r2 = (n: number) => Math.round(n * 100) / 100;

export async function getNickPayments({ account = null as string | null, month = null as string | null } = {}): Promise<NickPayments> {
  const accounts = await prisma.nickDropiAccount.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true } });
  const uploads = await prisma.nickWalletUpload.findMany({ orderBy: { createdAt: "desc" } });
  const accountId = account ?? uploads[0]?.accountId ?? null;
  const months = [...new Set(uploads.filter((u) => u.accountId === accountId).map((u) => u.month))].sort().reverse();
  const m = month && months.includes(month) ? month : (months[0] ?? null);

  const empty: NickPayments = {
    accounts,
    uploads: uploads.map((u) => ({ id: u.id, accountId: u.accountId, month: u.month, fileName: u.fileName, rows: u.rows, skipped: u.skipped, createdAt: u.createdAt.toISOString() })),
    months,
    account: accountId,
    month: m,
    counts: { delivered: 0, deliveredPaid: 0, deliveredUnpaid: 0, deliveredWaiting: 0, paidTwice: 0, paidReturned: 0, paidNotInNick: 0 },
    amounts: { paid: 0, unpaidEstimate: 0, indemnIn: 0, indemnOut: 0, warrantyCharges: 0, rejected: 0 },
    unpaid: [],
    paidTwice: [],
    paidReturned: [],
    indemnities: [],
  };
  if (!accountId || !m) return empty;
  const { from, to } = monthRange(m);

  const guides = await prisma.nickGuideStatus.findMany({
    where: { accountId, orderCreatedAt: { gte: from, lt: to } },
    select: { guideNumber: true, dropiOrderId: true, status: true, statusGroup: true, carrier: true, city: true, orderCreatedAt: true },
  });
  const pays = await prisma.nickWalletMovement.findMany({
    where: { accountId, kind: "PAGO_GUIA", guideNumber: { in: guides.map((g) => g.guideNumber) } },
    select: { guideNumber: true, amount: true, direction: true, at: true },
  });
  // Varios pagos de la misma guía a la MISMA hora = un pago por producto del
  // pedido (visto en el Excel de agosto 2026), no un pago repetido.
  const payBy = new Map<string, { sum: number; n: number; times: Set<number> }>();
  for (const p of pays) {
    const cur = payBy.get(p.guideNumber!) ?? { sum: 0, n: 0, times: new Set<number>() };
    cur.times.add(p.at.getTime());
    payBy.set(p.guideNumber!, { sum: cur.sum + (p.direction === "SALIDA" ? -p.amount : p.amount), n: cur.n + 1, times: cur.times });
  }
  // Hasta dónde llegan los archivos subidos de esta cuenta: una orden de menos
  // de 10 días antes de ese momento puede pagarse en el archivo siguiente.
  const lastPay = await prisma.nickWalletMovement.aggregate({ where: { accountId, kind: "PAGO_GUIA" }, _max: { at: true } });
  const coveredUntil = lastPay._max.at ? lastPay._max.at.getTime() - 10 * 864e5 : 0;
  const view = (g: (typeof guides)[number], est: number | null = null): PaymentGuide => ({
    guideNumber: g.guideNumber,
    orderId: g.dropiOrderId,
    status: g.status,
    carrier: g.carrier,
    city: g.city,
    orderDay: g.orderCreatedAt ? ecDay(g.orderCreatedAt) : null,
    paid: r2(payBy.get(g.guideNumber)?.sum ?? 0),
    payments: payBy.get(g.guideNumber)?.n ?? 0,
    estValue: est,
  });

  const delivered = guides.filter((g) => g.statusGroup === "ENTREGADA");
  const notPaid = delivered.filter((g) => !payBy.has(g.guideNumber));
  const unpaidRaw = notPaid.filter((g) => g.orderCreatedAt && g.orderCreatedAt.getTime() <= coveredUntil);
  const waiting = notPaid.length - unpaidRaw.length;
  const { byGuide } = await productValues(unpaidRaw.map((g) => g.guideNumber));
  // Sin corte guardado (ej. órdenes de agosto) no hay productos ni precio: se
  // usa lo que Dropi pagó en promedio por guía ese mes en esta cuenta.
  const paidGuides = delivered.filter((g) => payBy.has(g.guideNumber));
  const avgPaid = paidGuides.length ? paidGuides.reduce((a, g) => a + (payBy.get(g.guideNumber)?.sum ?? 0), 0) / paidGuides.length : null;
  const unpaid = unpaidRaw.map((g) => view(g, byGuide.get(g.guideNumber)?.price ?? (avgPaid == null ? null : r2(avgPaid))));
  const paidTwice = guides.filter((g) => (payBy.get(g.guideNumber)?.times.size ?? 0) > 1).map((g) => view(g));
  const paidReturned = guides.filter((g) => payBy.has(g.guideNumber) && (g.statusGroup === "DEVOLUCION" || g.statusGroup === "CANCELADA")).map((g) => view(g));

  // Pagos del mes (por fecha del movimiento) de guías que NICK no tiene.
  const known = new Set(guides.map((g) => g.guideNumber));
  const monthPays = await prisma.nickWalletMovement.findMany({ where: { accountId, kind: "PAGO_GUIA", at: { gte: from, lt: to } }, select: { guideNumber: true, amount: true } });
  const paidNotInNick = monthPays.filter((p) => p.guideNumber && !known.has(p.guideNumber)).length;

  const others = await prisma.nickWalletMovement.findMany({
    where: { accountId, kind: { not: "PAGO_GUIA" }, at: { gte: from, lt: to } },
    orderBy: { at: "asc" },
  });
  const sumKind = (k: string, dir?: string) => r2(others.filter((o) => o.kind === k && (!dir || o.direction === dir)).reduce((a, o) => a + o.amount, 0));

  return {
    ...empty,
    counts: {
      delivered: delivered.length,
      deliveredPaid: delivered.length - notPaid.length,
      deliveredUnpaid: unpaid.length,
      deliveredWaiting: waiting,
      paidTwice: paidTwice.length,
      paidReturned: paidReturned.length,
      paidNotInNick,
    },
    amounts: {
      paid: r2(pays.reduce((a, p) => a + (p.direction === "SALIDA" ? -p.amount : p.amount), 0)),
      unpaidEstimate: r2(unpaid.reduce((a, g) => a + (g.estValue ?? 0), 0)),
      indemnIn: sumKind("INDEMNIZACION", "ENTRADA"),
      indemnOut: sumKind("INDEMNIZACION", "SALIDA"),
      warrantyCharges: r2(sumKind("COBRO_FLETE_GARANTIA") + sumKind("COBRO_RECOLECCION_GARANTIA")),
      rejected: sumKind("RECHAZADO"),
    },
    unpaid: unpaid.sort((a, b) => (a.orderDay ?? "").localeCompare(b.orderDay ?? "")),
    paidTwice,
    paidReturned,
    indemnities: others
      .filter((o) => o.kind === "INDEMNIZACION")
      .map((o) => ({ at: o.at.toISOString(), direction: o.direction, amount: o.amount, orderId: o.orderId, guideNumber: o.guideNumber, description: o.description })),
  };
}
