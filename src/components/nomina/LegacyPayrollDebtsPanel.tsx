"use client";

import { useEffect, useState } from "react";
import { formatDateTime } from "@/lib/formatDateTime";

type Employee = { id: string; name: string; position: string | null };
type Debt = {
  id: string; totalAmount: number; reason: string; installments: number; firstPayoutMonth: string;
  createdAt: string; employee: { name: string };
};

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

// Confirmado 2026-09-11: pedido explícito del usuario — deudas de anticipos,
// compras personales o descuentos de ANTES de que existiera este sistema de
// nómina, que nunca quedaron registradas. Nairoby las carga una sola vez a
// mano, en cuotas, y de ahí en adelante buildAutomaticLineItems las
// descuenta solas — sin paso de aceptación del colaborador (a diferencia
// de "Descuentos por mala gestión"), porque es deuda real ya conocida.
export function LegacyPayrollDebtsPanel({ canEdit }: { canEdit: boolean }) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [debts, setDebts] = useState<Debt[] | null>(null);
  const [employeeId, setEmployeeId] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [reason, setReason] = useState("");
  const [installments, setInstallments] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function load() {
    if (canEdit) {
      fetch("/api/payroll/employees").then((r) => (r.ok ? r.json() : [])).then((rows) => setEmployees(rows.map((r: { id: string; name: string; position: string | null }) => ({ id: r.id, name: r.name, position: r.position }))));
    }
    fetch("/api/payroll/legacy-debts").then((r) => (r.ok ? r.json() : [])).then(setDebts);
  }
  useEffect(load, [canEdit]);

  function validate(): string {
    if (!employeeId) return "Elegí un colaborador.";
    if (!Number(totalAmount)) return "Ingresá un monto válido.";
    if (!reason.trim()) return "Contá de qué deuda se trata.";
    return "";
  }

  function onSendClick() {
    if (!confirming) {
      const problem = validate();
      if (problem) { setErr(problem); return; }
      setErr("");
      setConfirming(true);
      return;
    }
    setConfirming(false);
    submit();
  }

  async function submit() {
    const amount = Number(totalAmount);
    setBusy(true);
    setErr("");
    const res = await fetch("/api/payroll/legacy-debts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeId, totalAmount: amount, reason: reason.trim(), installments }),
    });
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) { setErr(data?.error ?? "No se pudo cargar."); return; }
    setEmployeeId(""); setTotalAmount(""); setReason(""); setInstallments(1);
    load();
  }

  async function remove(id: string) {
    if (deletingId !== id) { setDeletingId(id); return; }
    setDeletingId(null);
    await fetch(`/api/payroll/legacy-debts/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div>
      {canEdit && (
        <div className="bg-surface border border-rule rounded-md p-4 mb-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-3">Cargar deuda anterior al sistema</div>
          <div className="flex flex-col gap-2 max-w-sm">
            <select className="text-[13px] rounded border border-rule bg-cloud px-2.5 py-1.5" value={employeeId} onChange={(e) => { setEmployeeId(e.target.value); setConfirming(false); }}>
              <option value="">Elegí al colaborador…</option>
              {employees.map((e) => (<option key={e.id} value={e.id}>{e.name}</option>))}
            </select>
            <input className="text-[13px] rounded border border-rule bg-cloud px-2.5 py-1.5" type="number" step="0.01" placeholder="Monto total de la deuda" value={totalAmount} onChange={(e) => { setTotalAmount(e.target.value); setConfirming(false); }} />
            <textarea className="text-[12.5px] rounded border border-rule bg-cloud px-2.5 py-1.5" placeholder="De qué deuda se trata (ej. Anticipo de julio no registrado)" value={reason} onChange={(e) => { setReason(e.target.value); setConfirming(false); }} rows={2} />
            <div>
              <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Cuotas</label>
              <div className="flex gap-2">
                {[1, 2, 3, 4].map((n) => (
                  <button key={n} type="button" onClick={() => setInstallments(n)} className={`text-[12px] font-semibold rounded px-3 py-1.5 border cursor-pointer ${installments === n ? "border-teal text-teal bg-teal/10" : "border-rule text-steel"}`}>{n}</button>
                ))}
              </div>
            </div>
            {err && <div className="text-red text-[12.5px]">{err}</div>}
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={busy}
                className={`text-[13px] font-bold text-white rounded-md px-4 py-2 cursor-pointer disabled:opacity-50 self-start ${confirming ? "bg-red" : "bg-blue"}`}
                onClick={onSendClick}
              >
                {busy ? "Cargando…" : confirming ? "Confirmar y cargar" : "Cargar deuda"}
              </button>
              {confirming && !busy && (
                <button type="button" className="text-[12.5px] text-steel cursor-pointer" onClick={() => setConfirming(false)}>
                  Cancelar
                </button>
              )}
            </div>
            {confirming && !busy && (
              <div className="text-[11.5px] text-steel-dim">
                Esto va a descontar {money(Number(totalAmount) || 0)} del rol de {employees.find((e) => e.id === employeeId)?.name ?? "este colaborador"}, en {installments} cuota{installments > 1 ? "s" : ""} empezando este mes — se aplica solo, sin que el colaborador tenga que aceptarlo. Tocá de nuevo para confirmar.
              </div>
            )}
          </div>
        </div>
      )}

      <div className="bg-surface border border-rule rounded-md p-4">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-3">Deudas anteriores cargadas ({debts?.length ?? 0})</div>
        {(debts?.length ?? 0) === 0 && <div className="text-steel text-[12.5px]">Todavía no se cargó ninguna.</div>}
        <div className="flex flex-col gap-1.5">
          {debts?.map((d) => (
            <div key={d.id} className="flex items-center gap-3 text-[12.5px] py-1.5 border-b border-rule last:border-0 flex-wrap">
              <span className="font-semibold flex-1 min-w-[120px]">{d.employee.name}</span>
              <span className="font-bold tabular-nums">{money(d.totalAmount)}</span>
              {d.installments > 1 && <span className="text-steel-dim">({d.installments} cuotas)</span>}
              <span className="text-steel-dim">{d.reason}</span>
              <span className="text-[10.5px] text-steel-dim ml-auto">Cargada el {formatDateTime(d.createdAt)} — descuenta desde {d.firstPayoutMonth}</span>
              {canEdit && (
                <button
                  type="button"
                  className={`text-[11px] font-semibold cursor-pointer ${deletingId === d.id ? "text-white bg-red rounded px-2 py-0.5" : "text-red"}`}
                  onClick={() => remove(d.id)}
                  onBlur={() => setDeletingId((cur) => (cur === d.id ? null : cur))}
                >
                  {deletingId === d.id ? "¿Seguro? Tocá de nuevo" : "Borrar"}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
