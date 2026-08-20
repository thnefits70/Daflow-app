"use client";

import { useEffect, useState } from "react";
import { Banknote, CheckCircle2, Circle, Plus, TriangleAlert } from "lucide-react";
import { installmentAmount } from "@/lib/payrollCalc";

type BankAccount = {
  id: string; bankName: string; bankAccountType: string; bankAccountNumber: string; bankAccountHolder: string;
  holderIdType: "RUC" | "CEDULA" | null; holderIdNumber: string | null; isSelected: boolean;
};

type Advance = {
  id: string; amount: number; installments: number; status: string;
  justification: string | null; reason: "EMERGENCIA_FAMILIAR" | "OTRO" | null;
  transferProofUrl: string | null; firstPayoutMonth: string | null;
  createdAt: string;
};

// Confirmado 2026-08-20 — reglas de anticipos: $20 mínimo, hasta $100 sin
// justificar, de $100 a $200 con motivo obligatorio, y un tope de $150 de
// saldo pendiente de pago (sumando varios anticipos a la vez) que bloquea
// nuevas solicitudes hasta que las cuotas actuales se terminen de pagar.
const MIN_AMOUNT = 20;
const NO_REASON_MAX = 100;
const MAX_AMOUNT = 200;
const PENDING_CAP = 150;

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-EC", { day: "numeric", month: "short", year: "numeric" });
}

function formatMonth(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("es-EC", { month: "long", year: "numeric" });
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  PENDING: { label: "Esperando aprobación", color: "#D9A441" },
  APPROVED: { label: "Aprobado y transferido", color: "#22C55E" },
  REJECTED: { label: "Rechazado", color: "#C4453A" },
};

const REASON_LABEL: Record<string, string> = {
  EMERGENCIA_FAMILIAR: "Emergencia familiar",
  OTRO: "Otro motivo",
};

function BankAccountForm({ hasExisting, onSaved, onCancel }: { hasExisting: boolean; onSaved: () => void; onCancel: () => void }) {
  const [bankName, setBankName] = useState("");
  const [bankAccountType, setBankAccountType] = useState("Ahorros");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [bankAccountHolder, setBankAccountHolder] = useState("");
  const [holderIdNumber, setHolderIdNumber] = useState("");
  const [bankNames, setBankNames] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/employee-bank-account/bank-names").then((r) => (r.ok ? r.json() : [])).then(setBankNames);
  }, []);

  async function save() {
    if (!bankName.trim() || !bankAccountNumber.trim() || !bankAccountHolder.trim() || !holderIdNumber.trim()) return;
    setBusy(true);
    await fetch("/api/employee-bank-account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bankName: bankName.trim(), bankAccountType, bankAccountNumber: bankAccountNumber.trim(), bankAccountHolder: bankAccountHolder.trim(), holderIdType: "CEDULA", holderIdNumber: holderIdNumber.trim() }),
    });
    setBusy(false);
    onSaved();
  }

  return (
    <div className="bg-surface border border-rule rounded-md p-4 mb-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-3">
        {hasExisting ? "Agregar otra cuenta bancaria" : "Mi cuenta bancaria"}
      </div>
      <div className="flex flex-col gap-2 max-w-sm">
        <input list="bank-names-datalist" className="text-[12.5px] rounded border border-rule bg-cloud px-2.5 py-1.5" placeholder="Banco" value={bankName} onChange={(e) => setBankName(e.target.value)} />
        <datalist id="bank-names-datalist">{bankNames.map((n) => (<option key={n} value={n} />))}</datalist>
        <div className="flex gap-2">
          <button type="button" onClick={() => setBankAccountType("Ahorros")} className={`text-[12px] font-semibold rounded px-3 py-1.5 border cursor-pointer ${bankAccountType === "Ahorros" ? "border-teal text-teal bg-teal/10" : "border-rule text-steel"}`}>Ahorros</button>
          <button type="button" onClick={() => setBankAccountType("Corriente")} className={`text-[12px] font-semibold rounded px-3 py-1.5 border cursor-pointer ${bankAccountType === "Corriente" ? "border-teal text-teal bg-teal/10" : "border-rule text-steel"}`}>Corriente</button>
        </div>
        <input className="text-[12.5px] rounded border border-rule bg-cloud px-2.5 py-1.5" placeholder="N° de cuenta" value={bankAccountNumber} onChange={(e) => setBankAccountNumber(e.target.value)} />
        <input className="text-[12.5px] rounded border border-rule bg-cloud px-2.5 py-1.5" placeholder="Nombre del titular" value={bankAccountHolder} onChange={(e) => setBankAccountHolder(e.target.value)} />
        <input className="text-[12.5px] rounded border border-rule bg-cloud px-2.5 py-1.5" placeholder="N° de cédula" value={holderIdNumber} onChange={(e) => setHolderIdNumber(e.target.value)} />
        <div className="flex gap-2">
          <button type="button" disabled={busy} className="text-[12px] font-bold bg-blue text-white rounded px-3 py-1.5 cursor-pointer disabled:opacity-50" onClick={save}>
            {busy ? "Guardando…" : "Guardar cuenta"}
          </button>
          {hasExisting && (
            <button type="button" disabled={busy} className="text-[12px] font-semibold text-steel rounded px-3 py-1.5 cursor-pointer" onClick={onCancel}>
              Cancelar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function BankAccountList({ accounts, onSelect, onAddNew, busy }: { accounts: BankAccount[]; onSelect: (id: string) => void; onAddNew: () => void; busy: boolean }) {
  return (
    <div className="bg-surface border border-rule rounded-md p-4 mb-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-3">Mi cuenta bancaria</div>
      <div className="flex flex-col gap-2 max-w-sm">
        {accounts.map((a) => (
          <button
            key={a.id}
            type="button"
            disabled={busy || a.isSelected}
            onClick={() => onSelect(a.id)}
            className={`text-left rounded-md border px-3 py-2.5 cursor-pointer disabled:cursor-default ${a.isSelected ? "border-teal bg-teal/10" : "border-rule hover:border-steel"}`}
          >
            <div className="flex items-center gap-2">
              {a.isSelected ? <CheckCircle2 size={15} className="text-teal shrink-0" /> : <Circle size={15} className="text-steel-dim shrink-0" />}
              <span className="text-[12.5px] font-semibold text-ink">{a.bankName}</span>
              <span className="text-[11px] text-steel-dim">{a.bankAccountType}</span>
              {a.isSelected && <span className="ml-auto text-[10px] font-semibold text-teal uppercase tracking-wide">Cuenta activa</span>}
            </div>
            <div className="text-[12px] text-steel-dim mt-0.5">{a.bankAccountNumber} · {a.bankAccountHolder}</div>
          </button>
        ))}
        <button type="button" onClick={onAddNew} className="flex items-center gap-1.5 text-[12px] font-semibold text-blue cursor-pointer self-start mt-1">
          <Plus size={13} /> Agregar otra cuenta
        </button>
        {accounts.length > 1 && (
          <div className="text-[11px] text-steel-dim">Solo la cuenta activa se usa para transferir tus anticipos.</div>
        )}
      </div>
    </div>
  );
}

export function SalaryAdvancesPanel() {
  const [accounts, setAccounts] = useState<BankAccount[] | null>(null);
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [accountBusy, setAccountBusy] = useState(false);
  const [advances, setAdvances] = useState<Advance[] | null>(null);
  const [pendingTotal, setPendingTotal] = useState(0);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState<"EMERGENCIA_FAMILIAR" | "OTRO" | null>(null);
  const [justification, setJustification] = useState("");
  const [installments, setInstallments] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [confirming, setConfirming] = useState(false);

  function loadAccounts() {
    fetch("/api/employee-bank-account").then((r) => (r.ok ? r.json() : [])).then((list: BankAccount[]) => {
      setAccounts(list);
      setShowAddAccount(false);
    });
  }
  function load() {
    loadAccounts();
    fetch("/api/salary-advances")
      .then((r) => (r.ok ? r.json() : { items: [], pendingTotal: 0 }))
      .then((d) => { setAdvances(d.items); setPendingTotal(d.pendingTotal ?? 0); });
  }
  useEffect(load, []);

  const account = accounts?.find((a) => a.isSelected) ?? null;

  async function selectAccount(id: string) {
    setAccountBusy(true);
    await fetch("/api/employee-bank-account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selectId: id }),
    });
    setAccountBusy(false);
    loadAccounts();
  }

  const amt = Number(amount);
  const amountInRange = !!amount && amt >= MIN_AMOUNT && amt <= MAX_AMOUNT;
  const needsReason = amt > NO_REASON_MAX;
  const canInstallments = amt > 50;
  const blocked = pendingTotal >= PENDING_CAP;
  const reasonOk = !needsReason || reason === "EMERGENCIA_FAMILIAR" || (reason === "OTRO" && justification.trim().length >= 10);
  const canSubmit = !blocked && amountInRange && reasonOk;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setErr("");
    const res = await fetch("/api/salary-advances", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: amt,
        reason: needsReason ? reason ?? undefined : undefined,
        justification: needsReason && reason === "OTRO" ? justification.trim() : undefined,
        installments: canInstallments ? installments : 1,
      }),
    });
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) { setErr(data?.error ?? "No se pudo enviar."); return; }
    setAmount(""); setReason(null); setJustification(""); setInstallments(1); setConfirming(false);
    load();
  }

  function updateAmount(v: string) { setAmount(v); setConfirming(false); }
  function updateInstallments(n: number) { setInstallments(n); setConfirming(false); }
  function updateReason(r: "EMERGENCIA_FAMILIAR" | "OTRO") { setReason(r); setConfirming(false); }
  function updateJustification(v: string) { setJustification(v); setConfirming(false); }

  if (!advances || !accounts) return <div className="text-steel text-[13px]">Cargando…</div>;

  return (
    <div>
      <div className="bg-surface border border-rule rounded-md p-3.5 mb-4 text-[12px] text-steel leading-relaxed">
        Un anticipo es un adelanto de tu propio sueldo — <b className="text-ink">no es un préstamo</b> ni
        genera intereses ni deuda aparte. Se descuenta automáticamente de tu rol, en las cuotas mensuales que
        elijas al pedirlo.
      </div>

      {accounts.length > 0 && !showAddAccount && (
        <BankAccountList accounts={accounts} onSelect={selectAccount} onAddNew={() => setShowAddAccount(true)} busy={accountBusy} />
      )}
      {(accounts.length === 0 || showAddAccount) && (
        <BankAccountForm hasExisting={accounts.length > 0} onSaved={loadAccounts} onCancel={() => setShowAddAccount(false)} />
      )}

      <div className="bg-surface border border-rule rounded-md p-4 mb-4">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-3 flex items-center gap-1.5">
          <Banknote size={13} /> Solicitar anticipo
        </div>
        {!account ? (
          <div className="text-[12.5px] text-steel-dim">Primero registrá tu cuenta bancaria arriba.</div>
        ) : blocked ? (
          <div className="text-[12.5px] text-red leading-relaxed">
            Tenés {money(pendingTotal)} pendientes de pago en anticipos (tope {money(PENDING_CAP)}). Se
            habilita de nuevo cuando termines de pagar las cuotas de los anticipos actuales.
          </div>
        ) : (
          <div className="flex flex-col gap-2 max-w-sm">
            <div className="text-[11px] text-steel-dim">
              Mínimo {money(MIN_AMOUNT)} · hasta {money(NO_REASON_MAX)} sin explicar el motivo · de {money(NO_REASON_MAX)} a{" "}
              {money(MAX_AMOUNT)} con motivo obligatorio
            </div>
            <input className="text-[13px] rounded border border-rule bg-cloud px-2.5 py-1.5" type="number" step="0.01" placeholder="Monto" value={amount} onChange={(e) => updateAmount(e.target.value)} />
            {amount && !amountInRange && (
              <div className="text-red text-[11.5px]">El anticipo debe ser entre {money(MIN_AMOUNT)} y {money(MAX_AMOUNT)}.</div>
            )}
            {canInstallments && (
              <div>
                <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Descontar del rol en</label>
                <div className="flex gap-2">
                  {[1, 2, 3, 4].map((n) => (
                    <button key={n} type="button" onClick={() => updateInstallments(n)} className={`text-[12px] font-semibold rounded px-3 py-1.5 border cursor-pointer ${installments === n ? "border-teal text-teal bg-teal/10" : "border-rule text-steel"}`}>
                      {n === 1 ? "1 cuota" : `${n} cuotas`}
                    </button>
                  ))}
                </div>
                {installments > 1 && (
                  <div className="text-[11px] text-steel-dim mt-1.5">
                    {Array.from({ length: installments }, (_, i) => money(installmentAmount(amt, installments, i))).join(" + ")}
                    {" "}· una cuota por mes, empezando el mes en que se apruebe.
                  </div>
                )}
              </div>
            )}
            {needsReason && (
              <div className="flex items-start gap-2 rounded-md border border-[#D9A441]/50 bg-[#D9A441]/10 px-3 py-2 text-[11.5px] text-[#D9A441] leading-relaxed">
                <TriangleAlert size={14} className="shrink-0 mt-0.5" />
                <span>
                  Montos arriba de {money(NO_REASON_MAX)} se revisan caso por caso y normalmente solo se aprueban por
                  un tema de calamidad doméstica (emergencia familiar). Evitá pedir montos altos seguidos — si no es
                  una emergencia, es mejor pedir hasta {money(NO_REASON_MAX)} sin motivo.
                </span>
              </div>
            )}
            {needsReason && (
              <div>
                <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Motivo (obligatorio arriba de {money(NO_REASON_MAX)})</label>
                <div className="flex gap-2">
                  <button type="button" onClick={() => updateReason("EMERGENCIA_FAMILIAR")} className={`text-[12px] font-semibold rounded px-3 py-1.5 border cursor-pointer ${reason === "EMERGENCIA_FAMILIAR" ? "border-teal text-teal bg-teal/10" : "border-rule text-steel"}`}>
                    Emergencia familiar
                  </button>
                  <button type="button" onClick={() => updateReason("OTRO")} className={`text-[12px] font-semibold rounded px-3 py-1.5 border cursor-pointer ${reason === "OTRO" ? "border-teal text-teal bg-teal/10" : "border-rule text-steel"}`}>
                    Otro motivo
                  </button>
                </div>
              </div>
            )}
            {needsReason && reason === "OTRO" && (
              <textarea className="text-[12.5px] rounded border border-rule bg-cloud px-2.5 py-1.5" placeholder="Contá brevemente el motivo (mínimo 10 caracteres)" value={justification} onChange={(e) => updateJustification(e.target.value)} rows={2} />
            )}
            {pendingTotal > 0 && (
              <div className="text-[11px] text-steel-dim">Ya tenés {money(pendingTotal)} pendientes de pago (tope {money(PENDING_CAP)}).</div>
            )}
            {err && <div className="text-red text-[12.5px]">{err}</div>}
            {confirming ? (
              <div className="rounded-md border border-teal/50 bg-teal/10 px-3 py-2.5">
                <div className="text-[11px] text-steel-dim mb-1">Vas a pedir</div>
                <div className="text-[18px] font-bold text-ink tabular-nums">
                  {money(amt)}
                  {installments > 1 && <span className="text-[12px] font-semibold text-steel-dim"> en {installments} cuotas</span>}
                </div>
                {installments > 1 && (
                  <div className="text-[11px] text-steel-dim mt-0.5">
                    {Array.from({ length: installments }, (_, i) => money(installmentAmount(amt, installments, i))).join(" + ")}
                  </div>
                )}
                <div className="text-[11px] text-steel-dim mt-1.5">Revisá que el monto sea correcto antes de confirmar.</div>
                <div className="flex gap-2 mt-2.5">
                  <button type="button" disabled={busy} className="text-[13px] font-bold bg-blue text-white rounded-md px-4 py-2 cursor-pointer disabled:opacity-40" onClick={submit}>
                    {busy ? "Enviando…" : `Sí, confirmo ${money(amt)}`}
                  </button>
                  <button type="button" disabled={busy} className="text-[12.5px] font-semibold text-steel rounded-md px-3 py-2 cursor-pointer" onClick={() => setConfirming(false)}>
                    Corregir
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" disabled={busy || !canSubmit} className="text-[13px] font-bold bg-blue text-white rounded-md px-4 py-2 cursor-pointer disabled:opacity-40 self-start" onClick={() => setConfirming(true)}>
                Enviar solicitud
              </button>
            )}
          </div>
        )}
      </div>

      <div className="bg-surface border border-rule rounded-md p-4">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-3">Mis anticipos</div>
        {advances.length === 0 && <div className="text-steel text-[12.5px]">Todavía no pediste ningún anticipo.</div>}
        <div className="flex flex-col gap-2">
          {advances.map((a) => {
            const s = STATUS_LABEL[a.status];
            return (
              <div key={a.id} className="py-2 border-b border-rule last:border-0">
                <div className="flex items-center gap-3 text-[12.5px] flex-wrap">
                  <span className="font-bold tabular-nums">{money(a.amount)}</span>
                  {a.installments > 1 && <span className="text-steel-dim">({a.installments} cuotas, descontado del rol)</span>}
                  <span className="text-[10.5px] font-semibold rounded-full px-2 py-0.5" style={{ color: s.color, border: `1px solid ${s.color}` }}>{s.label}</span>
                </div>
                <div className="text-[11.5px] text-steel-dim mt-0.5">
                  Pedido el {formatDate(a.createdAt)}
                  {a.reason && <> · {REASON_LABEL[a.reason]}</>}
                  {a.status === "APPROVED" && a.firstPayoutMonth && <> · Descuento empieza en {formatMonth(a.firstPayoutMonth)}</>}
                  {a.status === "PENDING" && <> · El descuento en el rol empieza una vez que se apruebe, puede tardar</>}
                </div>
                {a.justification && <div className="text-[11.5px] text-steel-dim mt-0.5 italic">&ldquo;{a.justification}&rdquo;</div>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
