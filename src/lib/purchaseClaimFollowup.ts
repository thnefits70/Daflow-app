import { prisma } from "@/lib/prisma";
import { formatPurchaseRequestCode } from "@/lib/purchases";

// Pedido del usuario 2026-10-10 (caso SC-133 cámara GoPro: faltaban 10 desde
// el 2-oct y en 8 días nadie gestionó nada con CHEN). Lo que llegó mal o no
// llegó lo gestiona con el proveedor quien hizo ESA compra (y Jariel, que
// coordina Compras) — nunca Daniel, que solo revisa lo que llega a bodega.
// Dos etapas, las dos visibles en Inicio hasta que de verdad se cierren:
//   · "sin_gestion": el reclamo ya pasó la revisión de Daniel y todavía no
//     tiene solución registrada (reposición, crédito, sin stock…) por todo lo
//     afectado.
//   · "reposicion": se acordó que el proveedor repone, pero todavía no lo
//     envió ni llegó. Antes desaparecía de Inicio apenas se registraba la
//     reposición, aunque nunca llegara.
// Desde 2 días sin gestión (o reposición vencida / sin fecha) se le avisa a
// diario a quien compró (ver getPurchaseClaimFollowupPushes).

export const CLAIM_STALE_DAYS = 2;
const DAY_MS = 24 * 60 * 60 * 1000;

export type ClaimFollowupRow = {
  kind: "sin_gestion" | "reposicion";
  requestedById: string | null;
  code: string;
  productName: string;
  supplierName: string;
  qty: number;
  days: number;
  overdue: boolean;
  dueDate: Date | null;
};

const daysSince = (d: Date) => Math.max(0, Math.floor((Date.now() - d.getTime()) / DAY_MS));

export async function getClaimFollowupRows(requestedById?: string): Promise<ClaimFollowupRow[]> {
  const requestWhere = { status: { not: "REJECTED" as const }, ...(requestedById ? { requestedById } : {}) };
  const requestSelect = {
    requestedById: true,
    requestNumber: true,
    catalogItem: { select: { name: true } },
    supplier: { select: { name: true } },
  } as const;

  const [reports, replacements] = await Promise.all([
    prisma.purchaseRequestUrgentReport.findMany({
      where: { rejectedAt: null, reviewedByLeadAt: { not: null }, request: requestWhere },
      select: {
        damagedQty: true,
        missingQty: true,
        incompleteQty: true,
        differentQty: true,
        reviewedByLeadAt: true,
        resolutions: { select: { quantity: true, status: true } },
        request: { select: requestSelect },
      },
      orderBy: { reviewedByLeadAt: "asc" },
    }),
    prisma.purchaseUrgentResolution.findMany({
      where: {
        type: "REPLACEMENT",
        status: "PENDING",
        supplierShippedAt: null,
        replacementSubmittedAt: null,
        report: { rejectedAt: null, request: requestWhere },
      },
      select: { quantity: true, createdAt: true, replacementDueDate: true, report: { select: { request: { select: requestSelect } } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const base = (r: { requestedById: string | null; requestNumber: number | null; catalogItem: { name: string }; supplier: { name: string } }) => ({
    requestedById: r.requestedById,
    code: r.requestNumber ? formatPurchaseRequestCode(r.requestNumber) : "",
    productName: r.catalogItem.name,
    supplierName: r.supplier.name,
  });

  const rows: ClaimFollowupRow[] = [];
  for (const r of reports) {
    const total = r.damagedQty + r.missingQty + r.incompleteQty + r.differentQty;
    const claimed = r.resolutions.filter((res) => res.status !== "CANCELLED").reduce((s, res) => s + res.quantity, 0);
    if (claimed >= total) continue;
    const days = daysSince(r.reviewedByLeadAt!);
    rows.push({ kind: "sin_gestion", ...base(r.request), qty: total - claimed, days, overdue: days >= 1, dueDate: null });
  }
  const now = Date.now();
  for (const res of replacements) {
    const due = res.replacementDueDate;
    rows.push({
      kind: "reposicion",
      ...base(res.report.request),
      qty: res.quantity,
      days: daysSince(res.createdAt),
      // Sin fecha límite no hay forma de saber si CHEN se atrasó: también en rojo.
      overdue: !due || due.getTime() < now,
      dueDate: due,
    });
  }
  return rows;
}

function describe(r: ClaimFollowupRow) {
  const code = r.code ? `${r.code} · ` : "";
  if (r.kind === "sin_gestion") return `${code}${r.productName} · ${r.qty} un. · ${r.supplierName} · hace ${r.days} día${r.days === 1 ? "" : "s"}`;
  const when = r.dueDate
    ? r.dueDate.getTime() < Date.now()
      ? `venció el ${r.dueDate.toLocaleDateString("es-EC", { day: "numeric", month: "short", timeZone: "America/Guayaquil" })}`
      : `hasta el ${r.dueDate.toLocaleDateString("es-EC", { day: "numeric", month: "short", timeZone: "America/Guayaquil" })}`
    : "sin fecha límite";
  return `${code}${r.productName} · ${r.qty} un. · ${r.supplierName} · ${when}`;
}

export function describeClaimRows(rows: ClaimFollowupRow[]) {
  if (rows.length === 1) return describe(rows[0]);
  const oldest = [...rows].sort((a, b) => b.days - a.days)[0];
  return `${rows.length} productos · el más antiguo: ${describe(oldest)}`;
}

// Recordatorio diario (cron de las 8:00, nunca domingo) a quien hizo la compra.
// Si la compra no tiene quién la pidió, va a quienes coordinan Compras.
export async function getPurchaseClaimFollowupPushes(): Promise<{ ownerId: string; title: string; body: string; url: string }[]> {
  const rows = (await getClaimFollowupRows()).filter((r) => (r.kind === "sin_gestion" ? r.days >= CLAIM_STALE_DAYS : r.overdue));
  if (rows.length === 0) return [];

  const active = new Set((await prisma.user.findMany({ where: { isActive: true }, select: { id: true } })).map((u) => u.id));
  let managers: string[] | null = null;
  const byOwner = new Map<string, ClaimFollowupRow[]>();
  for (const r of rows) {
    let owners: string[];
    if (r.requestedById && active.has(r.requestedById)) owners = [r.requestedById];
    else {
      managers ??= (await prisma.user.findMany({ where: { isActive: true, canManagePurchases: true }, select: { id: true } })).map((u) => u.id);
      owners = managers;
    }
    for (const o of owners) byOwner.set(o, [...(byOwner.get(o) ?? []), r]);
  }

  return [...byOwner.entries()].map(([ownerId, list]) => {
    const pending = list.filter((r) => r.kind === "sin_gestion");
    const repl = list.filter((r) => r.kind === "reposicion");
    const title = pending.length ? "🚨 Reclamo al proveedor sin gestionar" : "⏰ Reposición del proveedor atrasada";
    const parts = [pending.length ? `Sin gestionar: ${describeClaimRows(pending)}` : "", repl.length ? `Reposición sin llegar: ${describeClaimRows(repl)}` : ""].filter(Boolean);
    return { ownerId, title, body: parts.join(" — "), url: "/area/workspace?tab=compras&ptab=urgentes" };
  });
}
