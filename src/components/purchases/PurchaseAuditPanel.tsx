"use client";

import { useEffect, useMemo, useState } from "react";
import { ShieldCheck, Search, CheckCircle2 } from "lucide-react";
import { actorName } from "@/lib/actorName";
import { formatDateTime } from "@/lib/formatDateTime";
import { PurchaseOperationDocuments, type OperationDocRow } from "./PurchaseOperationDocuments";
import { CatalogCode } from "@/components/shared/CatalogCode";

type Row = Omit<OperationDocRow, "receipt"> & {
  groupId: string;
  requestNumber: number | null;
  quantity: number;
  totalCost: number;
  requestedAt: string;
  reviewedAt: string | null;
  paidAt: string | null;
  invoicedAt: string | null;
  supplier: { name: string };
  urgentReports: { id: string }[];
  // Confirmado 2026-08-11: pedido explícito del usuario — solo visible acá
  // (Auditoría), nunca en Solicitar/Bandeja de aprobación/Finanzas.
  paymentProofReceiptNumber: string | null;
  shippingPaymentProofReceiptNumber: string | null;
  receipt: {
    photoUrls: string[];
    receivedQuantity: number;
    aiPhotoMatch: boolean | null;
    aiPhotoNote: string | null;
    confirmedBy: { name: string } | null;
    confirmedAt: string;
    justaUploadedBy: { name: string } | null;
    justaUploadedAt: string | null;
  } | null;
};

function formatPurchaseRequestCode(requestNumber: number | null): string {
  return requestNumber ? `SC-${String(requestNumber).padStart(3, "0")}` : "—";
}

function money(n: number) {
  return `$${n.toLocaleString("es-MX", { minimumFractionDigits: 2 })}`;
}

function durationParts(ms: number) {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  const mins = totalMin % 60;
  return { days, hours, mins };
}
// Compacto, para el desglose por etapa — "1d 2h", "9h 20min", "20min".
function formatDurationShort(ms: number) {
  const { days, hours, mins } = durationParts(ms);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return mins > 0 ? `${hours}h ${mins}min` : `${hours}h`;
  return `${mins}min`;
}
// Palabra completa, para el tiempo total destacado — "3 días 4h".
function formatDurationLong(ms: number) {
  const { days, hours, mins } = durationParts(ms);
  if (days > 0) return `${days} día${days === 1 ? "" : "s"} ${hours}h`;
  if (hours > 0) return mins > 0 ? `${hours}h ${mins}min` : `${hours}h`;
  return `${mins}min`;
}

// Confirmado 2026-08-13: pedido explícito del usuario — 4 etapas fijas,
// desde que se solicita hasta que Finanzas cierra la operación (lo último
// que puede pasar; si cierra ANTES de que Inventario confirme que llegó, la
// etapa de "Cierre" simplemente queda en 0 en vez de negativa).
const GOOD_MS = 24 * 60 * 60 * 1000;
const MID_MS = 3 * 24 * 60 * 60 * 1000;
function totalTimeClass(ms: number) {
  if (ms <= GOOD_MS) return "good";
  if (ms <= MID_MS) return "mid";
  return "slow";
}
function computeStageTimes(r0: Row) {
  if (!r0.reviewedAt || !r0.paidAt || !r0.receipt?.confirmedAt || !r0.invoicedAt) return null;
  const requestedAt = new Date(r0.requestedAt).getTime();
  const reviewedAt = new Date(r0.reviewedAt).getTime();
  const paidAt = new Date(r0.paidAt).getTime();
  const receivedAt = new Date(r0.receipt.confirmedAt).getTime();
  const closedAt = Math.max(receivedAt, new Date(r0.invoicedAt).getTime());
  return {
    totalMs: closedAt - requestedAt,
    stages: [
      { label: "Aprob.", ms: reviewedAt - requestedAt },
      { label: "Pago", ms: paidAt - reviewedAt },
      { label: "Recepción", ms: receivedAt - paidAt },
      { label: "Cierre", ms: Math.max(0, closedAt - receivedAt) },
    ],
  };
}

function groupRows(rows: Row[]) {
  const map = new Map<string, Row[]>();
  for (const r of rows) {
    if (!map.has(r.groupId)) map.set(r.groupId, []);
    map.get(r.groupId)!.push(r);
  }
  return [...map.values()];
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function recentMonths(): string[] {
  const now = new Date();
  const months: string[] = [];
  for (let i = 0; i <= 11; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}`);
  }
  return months;
}
function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return { from: `${month}-01`, to: `${month}-${pad2(lastDay)}` };
}
const MONTH_NAMES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
function monthFilterLabel(month: string) {
  const [y, m] = month.split("-");
  return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
}

// Confirmado 2026-08-08 (ampliado 2026-08-12): pantalla de solo lectura —
// el historial de todo lo que ya se confirmó recibido en bodega Y quedó
// completamente saneado (sin ningún reporte urgente pendiente de resolver
// con el proveedor) — mientras algo siga pendiente, NO aparece acá, sigue
// visible en Reportes urgentes hasta que se resuelva. Para auditar sin
// poder editar nada (ni borrar, ni cambiar estado). Ya no es exclusiva del
// admin: Bryan (Solicitar), Daniel (Inventario) y Nairoby (Finanzas)
// también la ven, siempre en modo solo lectura — cada quien ya tiene
// acceso de escritura a su propia parte de estas mismas operaciones.
// Filtra por fecha de recepción (receipt.confirmedAt), con selector de mes
// + búsqueda libre por producto/proveedor/código, para encontrar algo
// puntual rápido.
export function PurchaseAuditPanel() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [monthFilter, setMonthFilter] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch("/api/purchase-requests?view=audit").then((r) => (r.ok ? r.json() : [])).then(setRows).catch(() => setRows([]));
  }, []);

  function applyMonthFilter(month: string) {
    setMonthFilter(month);
    if (!month) { setDateFrom(""); setDateTo(""); return; }
    const { from, to } = monthBounds(month);
    setDateFrom(from);
    setDateTo(to);
  }
  function applyPrevMonth() {
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    applyMonthFilter(`${prev.getFullYear()}-${pad2(prev.getMonth() + 1)}`);
  }
  function clearDateFilter() {
    setMonthFilter("");
    setDateFrom("");
    setDateTo("");
  }

  const groups = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    const filtered = rows.filter((r) => {
      const confirmedAt = r.receipt?.confirmedAt ?? null;
      if ((dateFrom || dateTo) && confirmedAt) {
        const d = confirmedAt.slice(0, 10);
        if (dateFrom && d < dateFrom) return false;
        if (dateTo && d > dateTo) return false;
      }
      if (!q) return true;
      return (
        r.catalogItem.name.toLowerCase().includes(q) ||
        r.supplier.name.toLowerCase().includes(q) ||
        formatPurchaseRequestCode(r.requestNumber).toLowerCase().includes(q)
      );
    });
    return groupRows(filtered);
  }, [rows, dateFrom, dateTo, query]);

  if (!rows) return <div className="text-steel text-[13px]">Cargando…</div>;

  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-steel mb-2.5">
        <ShieldCheck size={13} /> Historial de lo ya recibido y saneado del todo — solo lectura
      </div>

      <div className="flex items-center gap-2 mb-3 flex-wrap text-[12px]">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-steel" />
          <input
            type="text"
            placeholder="Buscar producto, proveedor o código…"
            className="rounded border border-rule bg-cloud pl-7 pr-2.5 py-1.5 w-64"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select
          className="rounded border border-rule bg-cloud px-2 py-1.5 font-mono"
          value={monthFilter}
          onChange={(e) => applyMonthFilter(e.target.value)}
        >
          <option value="">Todos los meses</option>
          {recentMonths().map((m) => (
            <option key={m} value={m}>{monthFilterLabel(m)}</option>
          ))}
        </select>
        <button type="button" className="rounded border border-rule px-2.5 py-1.5 text-steel cursor-pointer hover:border-teal" onClick={applyPrevMonth}>
          Mes anterior
        </button>
        <label className="flex items-center gap-1.5 text-steel">
          Desde
          <input type="date" className="rounded border border-rule bg-cloud px-2 py-1.5" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setMonthFilter(""); }} />
        </label>
        <label className="flex items-center gap-1.5 text-steel">
          Hasta
          <input type="date" className="rounded border border-rule bg-cloud px-2 py-1.5" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setMonthFilter(""); }} />
        </label>
        {(dateFrom || dateTo || query) && (
          <button type="button" className="text-steel underline cursor-pointer" onClick={() => { clearDateFilter(); setQuery(""); }}>Limpiar</button>
        )}
        <span className="font-mono text-[10px] text-steel ml-auto">{groups.length} de {groupRows(rows).length}</span>
      </div>

      {groups.length === 0 && (
        <div className="border-[1.5px] border-dashed border-rule rounded-md p-6 text-center text-steel text-[13px]">
          {rows.length === 0 ? "Todavía no hay nada recibido y completamente saneado." : "Nada coincide con esa búsqueda o rango de fechas."}
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        {groups.map((g) => {
          const groupId = g[0].groupId;
          const total = g.reduce((s, r) => s + r.totalCost, 0);
          const r0 = g[0];
          const urgentCount = g.reduce((s, r) => s + r.urgentReports.length, 0);
          const timing = computeStageTimes(r0);
          return (
            <div key={groupId} className="bg-surface border border-rule rounded-md p-4">
              <div className="flex items-start justify-between gap-2 mb-1">
                <div>
                  {g.map((r) => (
                    <div key={r.id} className="text-[13.5px] font-bold flex items-center gap-1.5">
                      <CatalogCode code={r.catalogItem.justCode} />
                      <span>{r.catalogItem.name} · {r.quantity} un.</span>
                    </div>
                  ))}
                </div>
                <div className="flex flex-col items-end gap-0.5 shrink-0 max-w-[210px]">
                  <span className="font-mono text-[10.5px] text-steel">{formatPurchaseRequestCode(r0.requestNumber)}</span>
                  {timing && (
                    <>
                      {(() => {
                        const cls = totalTimeClass(timing.totalMs);
                        return (
                          <span
                            className={`text-[15px] font-extrabold tabular-nums mt-0.5 ${cls === "good" ? "text-green" : cls === "slow" ? "text-red" : ""}`}
                            style={cls === "mid" ? { color: "#D9A441" } : undefined}
                          >
                            {formatDurationLong(timing.totalMs)}
                          </span>
                        );
                      })()}
                      <span className="text-[10px] text-steel-dim text-right leading-snug tabular-nums">
                        {timing.stages.slice(0, 2).map((s) => `${s.label} ${formatDurationShort(s.ms)}`).join(" · ")}
                        <br />
                        {timing.stages.slice(2).map((s) => `${s.label} ${formatDurationShort(s.ms)}`).join(" · ")}
                      </span>
                    </>
                  )}
                </div>
              </div>
              <div className="text-[11.5px] text-steel">{r0.supplier.name} — {money(total)}</div>
              <div className="text-[10px] text-steel-dim mb-1">
                Solicitada por {actorName(r0.requestedBy?.name)} · Pagada por {actorName(r0.paidBy?.name)} · Recibida por {actorName(r0.receipt?.confirmedBy?.name)}
                {r0.receipt?.confirmedAt ? ` · ${formatDateTime(r0.receipt.confirmedAt)}` : ""}
                {/* Confirmado 2026-08-18: pedido explícito del usuario — Auditoría
                    es "el área ya completada" para el checklist de Just de Daniel. */}
                {r0.receipt?.justaUploadedAt
                  ? ` · Subido a Just por ${actorName(r0.receipt.justaUploadedBy?.name)} · ${formatDateTime(r0.receipt.justaUploadedAt)}`
                  : " · Pendiente de subir a Just"}
              </div>
              {(r0.paymentProofReceiptNumber || r0.shippingPaymentProofReceiptNumber) && (
                <div className="text-[10px] text-steel-dim mb-2.5 font-mono">
                  {r0.paymentProofReceiptNumber && <>N° comprobante mercadería: {r0.paymentProofReceiptNumber}</>}
                  {r0.paymentProofReceiptNumber && r0.shippingPaymentProofReceiptNumber && " · "}
                  {r0.shippingPaymentProofReceiptNumber && <>N° comprobante flete: {r0.shippingPaymentProofReceiptNumber}</>}
                </div>
              )}
              {!(r0.paymentProofReceiptNumber || r0.shippingPaymentProofReceiptNumber) && <div className="mb-2.5" />}

              {urgentCount > 0 && (
                <div className="flex items-center gap-1.5 bg-green/10 border border-green/30 rounded-md px-3 py-2 mb-2.5 text-[11.5px] text-green">
                  <CheckCircle2 size={13} /> {urgentCount} reporte{urgentCount === 1 ? "" : "s"} urgente{urgentCount === 1 ? "" : "s"} — ya resuelto{urgentCount === 1 ? "" : "s"} con el proveedor
                </div>
              )}

              <PurchaseOperationDocuments rows={g} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
