"use client";

import { useEffect, useMemo, useState } from "react";
import { ShieldCheck, Search, AlertTriangle } from "lucide-react";
import { actorName } from "@/lib/actorName";
import { PurchaseOperationDocuments, type OperationDocRow } from "./PurchaseOperationDocuments";

type Row = Omit<OperationDocRow, "receipt"> & {
  groupId: string;
  requestNumber: number | null;
  quantity: number;
  totalCost: number;
  requestedAt: string;
  paidAt: string | null;
  supplier: { name: string };
  urgentReports: { id: string }[];
  receipt: {
    photoUrls: string[];
    receivedQuantity: number;
    aiPhotoMatch: boolean | null;
    aiPhotoNote: string | null;
    confirmedBy: { name: string } | null;
    confirmedAt: string;
  } | null;
};

function formatPurchaseRequestCode(requestNumber: number | null): string {
  return requestNumber ? `SC-${String(requestNumber).padStart(3, "0")}` : "—";
}

function money(n: number) {
  return `$${n.toLocaleString("es-MX", { minimumFractionDigits: 2 })}`;
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

// Confirmado 2026-08-08: pantalla exclusiva del admin, de solo lectura — el
// historial completo de todo lo que ya se confirmó recibido en bodega, para
// auditar sin poder editar nada (ni borrar, ni cambiar estado). Filtra por
// fecha de recepción (receipt.confirmedAt), con selector de mes + búsqueda
// libre por producto/proveedor/código, para encontrar algo puntual rápido.
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
        <ShieldCheck size={13} /> Historial de todo lo recibido — solo lectura
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
          {rows.length === 0 ? "Todavía no hay nada confirmado como recibido." : "Nada coincide con esa búsqueda o rango de fechas."}
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        {groups.map((g) => {
          const groupId = g[0].groupId;
          const total = g.reduce((s, r) => s + r.totalCost, 0);
          const r0 = g[0];
          const urgentCount = g.reduce((s, r) => s + r.urgentReports.length, 0);
          return (
            <div key={groupId} className="bg-surface border border-rule rounded-md p-4">
              <div className="flex items-start justify-between gap-2 mb-1">
                <div>
                  {g.map((r) => (
                    <div key={r.id} className="text-[13.5px] font-bold">{r.catalogItem.name} · {r.quantity} un.</div>
                  ))}
                </div>
                <span className="font-mono text-[10.5px] text-steel shrink-0">{formatPurchaseRequestCode(r0.requestNumber)}</span>
              </div>
              <div className="text-[11.5px] text-steel">{r0.supplier.name} — {money(total)}</div>
              <div className="text-[10px] text-steel-dim mb-2.5">
                Solicitada por {actorName(r0.requestedBy?.name)} · Pagada por {actorName(r0.paidBy?.name)} · Recibida por {actorName(r0.receipt?.confirmedBy?.name)}
                {r0.receipt?.confirmedAt ? ` · ${new Date(r0.receipt.confirmedAt).toLocaleDateString("es-MX")}` : ""}
              </div>

              {urgentCount > 0 && (
                <div className="flex items-center gap-1.5 bg-gold/10 border border-gold/35 rounded-md px-3 py-2 mb-2.5 text-[11.5px]" style={{ color: "#D9A441" }}>
                  <AlertTriangle size={13} /> {urgentCount} reporte{urgentCount === 1 ? "" : "s"} urgente{urgentCount === 1 ? "" : "s"} en esta operación
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
