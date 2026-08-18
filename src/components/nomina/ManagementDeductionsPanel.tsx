"use client";

import { useEffect, useState } from "react";
import { compressImage } from "@/lib/compressImage";
import { uploadFile } from "@/lib/uploadFile";

type Employee = { id: string; name: string; position: string | null };
type Deduction = {
  id: string; totalAmount: number; reason: string; installments: number; startMonth: string;
  acceptedAt: string | null; employee: { name: string };
};

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

function nextMonths(count: number): string[] {
  const now = new Date();
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

// Confirmado 2026-08-18: solo el admin crea esto — el colaborador afectado
// tiene que aceptarlo explícitamente antes de que se aplique a su rol.
export function ManagementDeductionsPanel() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [deductions, setDeductions] = useState<Deduction[] | null>(null);
  const [employeeId, setEmployeeId] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [reason, setReason] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [installments, setInstallments] = useState(1);
  const [startMonth, setStartMonth] = useState(nextMonths(1)[0]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  function load() {
    fetch("/api/payroll/employees").then((r) => (r.ok ? r.json() : [])).then((rows) => setEmployees(rows.map((r: { id: string; name: string; position: string | null }) => ({ id: r.id, name: r.name, position: r.position }))));
    fetch("/api/management-deductions").then((r) => (r.ok ? r.json() : [])).then(setDeductions);
  }
  useEffect(load, []);

  async function onEvidence(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const compressed = file.type.startsWith("image/") ? await compressImage(file) : file;
    const result = await uploadFile(compressed, "mismanagement-evidence");
    setUploading(false);
    if (result.ok) setEvidenceUrl(result.url);
  }

  async function submit() {
    const amount = Number(totalAmount);
    if (!employeeId || !amount || !reason.trim()) return;
    setBusy(true);
    setErr("");
    const res = await fetch("/api/management-deductions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeId, totalAmount: amount, reason: reason.trim(), evidenceUrl: evidenceUrl || undefined, installments, startMonth }),
    });
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) { setErr(data?.error ?? "No se pudo crear."); return; }
    setEmployeeId(""); setTotalAmount(""); setReason(""); setEvidenceUrl(""); setInstallments(1);
    load();
  }

  return (
    <div>
      <div className="bg-surface border border-rule rounded-md p-4 mb-4">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-3">Nuevo descuento por mala gestión</div>
        <div className="flex flex-col gap-2 max-w-sm">
          <select className="text-[13px] rounded border border-rule bg-cloud px-2.5 py-1.5" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">Elegí al colaborador…</option>
            {employees.map((e) => (<option key={e.id} value={e.id}>{e.name}</option>))}
          </select>
          <input className="text-[13px] rounded border border-rule bg-cloud px-2.5 py-1.5" type="number" step="0.01" placeholder="Monto total" value={totalAmount} onChange={(e) => setTotalAmount(e.target.value)} />
          <textarea className="text-[12.5px] rounded border border-rule bg-cloud px-2.5 py-1.5" placeholder="Motivo (obligatorio)" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
          <label className="text-[11.5px] font-semibold text-blue cursor-pointer">
            {uploading ? "Subiendo…" : evidenceUrl ? "Evidencia lista — cambiar" : "Agregar evidencia (opcional)"}
            <input type="file" accept="image/*,application/pdf" className="hidden" onChange={onEvidence} />
          </label>
          <div>
            <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Cuotas</label>
            <div className="flex gap-2">
              {[1, 2, 3, 4].map((n) => (
                <button key={n} type="button" onClick={() => setInstallments(n)} className={`text-[12px] font-semibold rounded px-3 py-1.5 border cursor-pointer ${installments === n ? "border-teal text-teal bg-teal/10" : "border-rule text-steel"}`}>{n}</button>
              ))}
            </div>
          </div>
          <div>
            <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Mes de arranque</label>
            <select className="text-[13px] rounded border border-rule bg-cloud px-2.5 py-1.5" value={startMonth} onChange={(e) => setStartMonth(e.target.value)}>
              {nextMonths(6).map((m) => (<option key={m} value={m}>{m}</option>))}
            </select>
          </div>
          {err && <div className="text-red text-[12.5px]">{err}</div>}
          <button type="button" disabled={busy} className="text-[13px] font-bold bg-blue text-white rounded-md px-4 py-2 cursor-pointer disabled:opacity-50 self-start" onClick={submit}>
            {busy ? "Enviando…" : "Enviar al colaborador"}
          </button>
        </div>
      </div>

      <div className="bg-surface border border-rule rounded-md p-4">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-3">Historial</div>
        {(deductions?.length ?? 0) === 0 && <div className="text-steel text-[12.5px]">Todavía no hay ninguno.</div>}
        <div className="flex flex-col gap-1.5">
          {deductions?.map((d) => (
            <div key={d.id} className="flex items-center gap-3 text-[12.5px] py-1.5 border-b border-rule last:border-0 flex-wrap">
              <span className="font-semibold flex-1 min-w-[120px]">{d.employee.name}</span>
              <span className="font-bold tabular-nums">{money(d.totalAmount)}</span>
              <span className="text-steel-dim">{d.reason}</span>
              <span className={`text-[10.5px] font-semibold rounded-full px-2 py-0.5 ${d.acceptedAt ? "text-green border border-green" : "text-steel border border-rule"}`}>
                {d.acceptedAt ? "Aceptado" : "Esperando aceptación"}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
