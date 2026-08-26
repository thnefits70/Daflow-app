"use client";

import { useEffect, useMemo, useState } from "react";
import { X, ShieldCheck, Landmark, ChevronDown, CheckCircle2 } from "lucide-react";
import { ProofPreview } from "@/components/shared/ProofPreview";
import { PayrollEmployeeSalariesPanel } from "./PayrollEmployeeSalariesPanel";
import { CeoBonusesForNairobyPanel } from "./CeoBonusesForNairobyPanel";
import { PayrollTransferPanel, type Transfer } from "./PayrollTransferPanel";
import { PayoutUploader } from "./PayrollIndividualPayment";
import { isEndOfMonthQuincena } from "@/lib/payrollCalc";

type LineItem = { id?: string; label: string; amount: number; kind: "INCOME" | "EXPENSE"; isAutomatic?: boolean; note?: string | null };
type EmployeeBankAccount = {
  bankName: string;
  bankAccountType: string;
  bankAccountNumber: string;
  bankAccountHolder: string;
  holderIdType: "RUC" | "CEDULA" | null;
  holderIdNumber: string | null;
};
type Role = {
  id: string;
  employeeId: string;
  version: number;
  changeNote: string | null;
  totalIncome: number;
  totalExpense: number;
  netTotal: number;
  employee: { id: string; name: string; position: string | null; employeeBankAccounts: EmployeeBankAccount[]; payrollProfile: { iessDeclaredSalary: number | null } | null };
  lineItems: LineItem[];
  paidAt: string | null;
  paidProofUrl: string | null;
  paidProofName: string | null;
};
type PeriodDetail = {
  period: string;
  status: "DRAFT" | "PUBLISHED" | "NOT_GENERATED";
  roles: Role[];
  monthlyRoleIdByEmployee?: Record<string, string>;
  missingEmployees?: { id: string; name: string; position: string | null }[];
};

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

const ECUADOR_UTC_OFFSET_HOURS = 5; // UTC-5, sin horario de verano en Ecuador
function nowInEcuador(): Date {
  return new Date(Date.now() - ECUADOR_UTC_OFFSET_HOURS * 3600 * 1000);
}

function recentPeriods(): string[] {
  const out: string[] = [];
  const now = nowInEcuador();
  for (let i = 0; i < 4; i++) {
    const d = new Date(now.getUTCFullYear(), now.getUTCMonth() - i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    out.push(`${ym}-Q2`, `${ym}-Q1`);
  }
  return out;
}

// Confirmado 2026-08-14: bug real encontrado por el usuario — el selector
// por defecto siempre caía en la Q2 (16-fin) del mes actual, aunque hoy
// todavía estuviera en la primera quincena, mostrando una quincena que ni
// siquiera había empezado. Ahora arranca en la quincena que corre hoy.
function currentPeriod(): string {
  const now = nowInEcuador();
  const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return `${ym}-${now.getUTCDate() <= 15 ? "Q1" : "Q2"}`;
}
function periodLabel(period: string) {
  const [y, m, q] = period.split("-");
  const MONTHS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  const monthName = MONTHS[Number(m) - 1];
  return q === "Q1" ? `1-15 ${monthName} ${y}` : `16-fin ${monthName} ${y}`;
}

function NewConceptForm({ onAdd }: { onAdd: (item: LineItem) => void }) {
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState<"INCOME" | "EXPENSE">("EXPENSE");
  return (
    <div className="flex items-center gap-2 mt-2 flex-wrap">
      <input className="text-[12px] rounded border border-rule bg-cloud px-2 py-1 flex-1 min-w-[160px]" placeholder="Concepto (ej. Anticipo, Bono)" value={label} onChange={(e) => setLabel(e.target.value)} />
      <input className="text-[12px] rounded border border-rule bg-cloud px-2 py-1 w-24" type="number" step="0.01" placeholder="Monto" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <select className="text-[12px] rounded border border-rule bg-cloud px-2 py-1" value={kind} onChange={(e) => setKind(e.target.value as "INCOME" | "EXPENSE")}>
        <option value="EXPENSE">Descuento</option>
        <option value="INCOME">Ingreso</option>
      </select>
      <button
        type="button"
        className="text-[11.5px] font-semibold text-blue cursor-pointer"
        onClick={() => {
          const amt = Number(amount);
          if (!label.trim() || !amt || amt <= 0) return;
          onAdd({ label: label.trim(), amount: amt, kind });
          setLabel(""); setAmount("");
        }}
      >
        + Agregar
      </button>
    </div>
  );
}

const ROLE_CARD_ACCENTS = [
  "bg-surface border-l-blue/70",
  "bg-cloud border-l-teal/70",
] as const;

function RoleCard({ role, index, published, canEdit, monthlyRoleId, showPayout, onChanged }: { role: Role; index: number; published: boolean; canEdit: boolean; monthlyRoleId?: string; showPayout: boolean; onChanged: () => void }) {
  const [items, setItems] = useState<LineItem[]>(role.lineItems);
  const [savedItems, setSavedItems] = useState<LineItem[]>(role.lineItems);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [correcting, setCorrecting] = useState(false);
  const [changeNote, setChangeNote] = useState("");
  const [correctingMonthly, setCorrectingMonthly] = useState(false);
  const [monthlyChangeNote, setMonthlyChangeNote] = useState("");
  const [savingMonthly, setSavingMonthly] = useState(false);
  const [showZero, setShowZero] = useState(false);
  const [showBank, setShowBank] = useState(false);
  const [undoingPayout, setUndoingPayout] = useState(false);
  const bankAccount = role.employee.employeeBankAccounts[0];
  // Confirmado 2026-08-25: pedido de Nairoby — en la línea "Sueldo" no se
  // debe mostrar el sueldo real quincenal, sino el sueldo declarado al IESS
  // (es lo que ella usa como referencia). Es solo un cambio visual: el
  // monto real de la línea (usado en totales y en el líquido a pagar que se
  // transfiere) no cambia.
  const declaredSalary = role.employee.payrollProfile?.iessDeclaredSalary ?? null;
  function displayAmount(it: LineItem) {
    return it.isAutomatic && it.label === "Sueldo" && declaredSalary != null ? declaredSalary : it.amount;
  }

  async function undoPayout() {
    setUndoingPayout(true);
    await fetch(`/api/payroll/roles/${role.id}/individual-payment`, { method: "DELETE" });
    setUndoingPayout(false);
    onChanged();
  }

  async function submitMonthlyCorrection() {
    if (!monthlyRoleId || !monthlyChangeNote.trim()) return;
    setSavingMonthly(true);
    await fetch(`/api/payroll/monthly-role/${monthlyRoleId}/correct`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ changeNote: monthlyChangeNote.trim() }),
    });
    setSavingMonthly(false);
    setCorrectingMonthly(false);
    setMonthlyChangeNote("");
    onChanged();
  }

  // Confirmado 2026-08-25: pedido del usuario — antes cada click en "x" o
  // "+Agregar" guardaba solo (un PATCH por click). Ahora esos clicks solo
  // actualizan la lista en memoria; recién "Guardar cambios" persiste todo
  // junto y refresca el total de arriba (evita ediciones a medias
  // disparando varios guardados sueltos).
  function stageChange(next: LineItem[]) {
    setItems(next);
    setSaveError("");
  }

  const isDirty = !published && JSON.stringify(items) !== JSON.stringify(savedItems);

  // Confirmado 2026-08-25: bug real encontrado por el usuario — el schema
  // del backend rechazaba amount=0 (placeholders automáticos como
  // "Anticipos" sin nada activo), así que este PATCH fallaba con 400 en
  // silencio: el botón desaparecía como si hubiera guardado, pero el
  // servidor nunca actualizaba nada. Ahora si la respuesta no es ok, se
  // mantiene el aviso de "cambios sin guardar" y se muestra el error.
  async function saveChanges() {
    if (published) return;
    setSaving(true);
    setSaveError("");
    let res: Response;
    try {
      res = await fetch(`/api/payroll/roles/${role.id}/line-items`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineItems: items }),
      });
    } catch {
      setSaving(false);
      setSaveError("No se pudo conectar con el servidor — revisá tu internet e intentá de nuevo.");
      return;
    }
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setSaveError(data?.error ?? "No se pudo guardar — intentá de nuevo.");
      return;
    }
    setSavedItems(items);
    onChanged();
  }

  async function submitCorrection() {
    if (!changeNote.trim()) return;
    setSaving(true);
    setSaveError("");
    let res: Response;
    try {
      res = await fetch(`/api/payroll/roles/${role.id}/correct`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineItems: items, changeNote: changeNote.trim() }),
      });
    } catch {
      setSaving(false);
      setSaveError("No se pudo conectar con el servidor — revisá tu internet e intentá de nuevo.");
      return;
    }
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setSaveError(data?.error ?? "No se pudo guardar la corrección — intentá de nuevo.");
      return;
    }
    setCorrecting(false);
    setChangeNote("");
    onChanged();
  }

  const totalIncome = items.filter((i) => i.kind === "INCOME").reduce((s, i) => s + i.amount, 0);
  const totalExpense = items.filter((i) => i.kind === "EXPENSE").reduce((s, i) => s + i.amount, 0);
  const total = totalIncome - totalExpense;
  const editingEnabled = canEdit && (!published || correcting);

  const indexed = items.map((it, idx) => ({ it, idx }));
  const withValue = indexed.filter(({ it }) => it.amount !== 0);
  const withoutValue = indexed.filter(({ it }) => it.amount === 0);

  return (
    <div className={`border border-rule border-l-[3px] rounded-md p-3.5 ${ROLE_CARD_ACCENTS[index % ROLE_CARD_ACCENTS.length]}`}>
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <div>
          <div className="font-bold text-[13.5px]">{role.employee.name}</div>
          {role.employee.position && <div className="text-[10.5px] text-steel">{role.employee.position}</div>}
        </div>
        <div className="flex flex-col items-end gap-0.5 bg-teal/15 border border-teal/40 rounded-md px-2.5 py-1">
          <div className="text-[17px] font-extrabold tabular-nums text-teal">{money(total)}</div>
          <div className="text-[9.5px] text-teal/90 uppercase tracking-wide font-semibold">Líquido a pagar</div>
        </div>
      </div>

      <button
        type="button"
        className={`flex items-center gap-1.5 text-[11px] font-semibold rounded px-2 py-1 mb-2.5 cursor-pointer border ${bankAccount ? "text-steel border-rule" : "text-gold border-gold/40"}`}
        style={bankAccount ? undefined : { color: "#D9A441" }}
        onClick={() => setShowBank((s) => !s)}
      >
        <Landmark size={12} />
        {bankAccount ? "Cuenta bancaria" : "Sin cuenta bancaria registrada"}
        <ChevronDown size={12} className={showBank ? "rotate-180" : ""} />
      </button>
      {showBank && (
        <div className="mb-2.5 -mt-1.5 p-2.5 rounded bg-cloud border border-rule text-[12px] flex flex-col gap-1">
          {bankAccount ? (
            <>
              <div className="flex justify-between"><span className="text-steel">Banco</span><span className="font-semibold">{bankAccount.bankName}</span></div>
              <div className="flex justify-between"><span className="text-steel">Tipo de cuenta</span><span className="font-semibold">{bankAccount.bankAccountType}</span></div>
              <div className="flex justify-between"><span className="text-steel">N° de cuenta</span><span className="font-semibold tabular-nums">{bankAccount.bankAccountNumber}</span></div>
              <div className="flex justify-between"><span className="text-steel">Titular</span><span className="font-semibold">{bankAccount.bankAccountHolder}</span></div>
              {bankAccount.holderIdNumber && (
                <div className="flex justify-between"><span className="text-steel">{bankAccount.holderIdType === "RUC" ? "RUC" : "Cédula"}</span><span className="font-semibold tabular-nums">{bankAccount.holderIdNumber}</span></div>
              )}
            </>
          ) : (
            <span className="text-steel-dim italic">Este colaborador todavía no registró su cuenta bancaria en Mi Nómina.</span>
          )}
        </div>
      )}

      {withValue.length === 0 && <div className="text-[11.5px] text-steel-dim italic">Sin conceptos con valor este período.</div>}

      <div className="flex flex-col gap-2">
        {withValue.map(({ it, idx }) => (
          <div key={idx}>
            <div className="flex items-center gap-2 text-[12.5px]">
              <span className="flex-1 text-ink font-medium">{it.label}</span>
              <span className={`font-bold tabular-nums ${it.kind === "INCOME" ? "text-green" : "text-red"}`}>
                {it.kind === "INCOME" ? "+" : "−"}{money(displayAmount(it))}
              </span>
              {editingEnabled && (
                <button type="button" className="text-steel-dim cursor-pointer" onClick={() => stageChange(items.filter((_, i) => i !== idx))}>
                  <X size={12} />
                </button>
              )}
            </div>
            {it.note && <div className="text-[11px] text-steel-dim mt-0.5 leading-snug">{it.note}</div>}
          </div>
        ))}
      </div>

      {withoutValue.length > 0 && (
        <div className={withValue.length > 0 ? "mt-2.5 pt-2 border-t border-rule" : "mt-1"}>
          <button
            type="button"
            className="text-[11px] text-blue font-semibold cursor-pointer flex items-center gap-1"
            onClick={() => setShowZero((s) => !s)}
          >
            {showZero ? "Ocultar" : "Ver"} {withoutValue.length} concepto{withoutValue.length > 1 ? "s" : ""} sin novedad {showZero ? "▴" : "▾"}
          </button>
          {showZero && (
            <div className="mt-2 flex flex-col gap-2 pl-2.5 border-l-2 border-rule">
              {withoutValue.map(({ it, idx }) => (
                <div key={idx} className="text-[11px]">
                  <div className="flex items-center gap-2">
                    <span className="flex-1 text-steel font-medium">{it.label}</span>
                    {editingEnabled && (
                      <button type="button" className="text-steel-dim cursor-pointer" onClick={() => stageChange(items.filter((_, i) => i !== idx))}>
                        <X size={10} />
                      </button>
                    )}
                  </div>
                  {it.note && <div className="text-steel-dim mt-0.5 leading-snug">{it.note}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-2.5 pt-2 border-t border-rule flex flex-col gap-1 text-[12px]">
        <div className="flex justify-between text-steel"><span>Total ingresos</span><span className="text-green font-semibold tabular-nums">{money(totalIncome)}</span></div>
        <div className="flex justify-between text-steel"><span>Total descuentos</span><span className="text-red font-semibold tabular-nums">{money(totalExpense)}</span></div>
        <div className="flex justify-between font-bold text-[13px] mt-0.5"><span>Líquido a pagar</span><span className="tabular-nums">{money(total)}</span></div>
      </div>

      {showPayout && (
        <div className="mt-2.5 pt-2.5 border-t border-rule">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-steel mb-1.5">Comprobante de pago a {role.employee.name.split(" ")[0]}</div>
          {role.paidAt ? (
            <div>
              <div className="text-[11.5px] text-green font-semibold flex items-center gap-1.5">
                <CheckCircle2 size={13} /> Pagado — {new Date(role.paidAt).toLocaleDateString("es-EC")}
              </div>
              {role.paidProofUrl && (
                <div className="mt-1.5">
                  <ProofPreview url={role.paidProofUrl} filename={role.paidProofName ?? undefined} />
                </div>
              )}
              {canEdit && (
                <button type="button" disabled={undoingPayout} className="text-[10.5px] text-steel-dim underline cursor-pointer mt-1.5 disabled:opacity-50" onClick={undoPayout}>
                  {undoingPayout ? "Deshaciendo…" : "Deshacer — subí un comprobante equivocado"}
                </button>
              )}
            </div>
          ) : canEdit ? (
            <PayoutUploader roleId={role.id} expectedAmount={total} onSent={onChanged} />
          ) : (
            <div className="text-[11px]" style={{ color: "#D9A441" }}>Pendiente de pago</div>
          )}
        </div>
      )}

      {editingEnabled && <NewConceptForm onAdd={(item) => stageChange([...items, item])} />}
      {isDirty && (
        <div className="flex items-center gap-2 mt-2">
          <button
            type="button"
            disabled={saving}
            className="text-[12px] font-bold bg-teal text-white rounded-md px-3.5 py-1.5 cursor-pointer disabled:opacity-50"
            onClick={saveChanges}
          >
            {saving ? "Guardando…" : "Guardar cambios"}
          </button>
          <button type="button" disabled={saving} className="text-[11.5px] text-steel cursor-pointer disabled:opacity-50" onClick={() => setItems(savedItems)}>
            Descartar
          </button>
          <span className="text-[10.5px] text-gold">Cambios sin guardar</span>
        </div>
      )}
      {saveError && <div className="text-[11px] text-red mt-1.5">{saveError}</div>}

      {published && !correcting && canEdit && (
        <button type="button" className="text-[11px] text-blue font-semibold cursor-pointer mt-2.5" onClick={() => setCorrecting(true)}>
          Corregir este rol
        </button>
      )}
      {correcting && (
        <div className="mt-3 pt-3 border-t border-rule">
          <input
            className="text-[12px] rounded border border-rule bg-cloud px-2 py-1.5 w-full mb-2"
            placeholder="Motivo del cambio (obligatorio, nota interna)"
            value={changeNote}
            onChange={(e) => setChangeNote(e.target.value)}
          />
          <div className="flex gap-2">
            <button type="button" disabled={!changeNote.trim() || saving} className="text-[12px] font-bold bg-blue text-white rounded px-3 py-1.5 cursor-pointer disabled:opacity-50" onClick={submitCorrection}>
              Guardar corrección y republicar
            </button>
            <button type="button" className="text-[12px] text-steel cursor-pointer" onClick={() => { setCorrecting(false); setItems(role.lineItems); }}>
              Cancelar
            </button>
          </div>
        </div>
      )}
      {role.changeNote && <div className="text-[10.5px] text-steel-dim mt-2 italic">Corregido — {role.changeNote}</div>}

      {published && monthlyRoleId && canEdit && !correctingMonthly && (
        <button type="button" className="text-[11px] text-blue font-semibold cursor-pointer mt-1.5 block" onClick={() => setCorrectingMonthly(true)}>
          Corregir el &quot;Rol del mes&quot; que ve este colaborador
        </button>
      )}
      {correctingMonthly && (
        <div className="mt-3 pt-3 border-t border-rule">
          <div className="text-[10.5px] text-steel-dim mb-2">
            Recalcula desde el sueldo declarado vigente en su perfil — si el error era ese, corregilo ahí primero.
          </div>
          <input
            className="text-[12px] rounded border border-rule bg-cloud px-2 py-1.5 w-full mb-2"
            placeholder="Motivo del cambio — el colaborador lo va a ver"
            value={monthlyChangeNote}
            onChange={(e) => setMonthlyChangeNote(e.target.value)}
          />
          <div className="flex gap-2">
            <button type="button" disabled={!monthlyChangeNote.trim() || savingMonthly} className="text-[12px] font-bold bg-blue text-white rounded px-3 py-1.5 cursor-pointer disabled:opacity-50" onClick={submitMonthlyCorrection}>
              Guardar y republicar su Rol del mes
            </button>
            <button type="button" className="text-[12px] text-steel cursor-pointer" onClick={() => { setCorrectingMonthly(false); setMonthlyChangeNote(""); }}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Confirmado 2026-08-13: pantalla de gestión de Nómina — Nairoby edita
// (canEdit), admin solo ve exactamente esto sin ningún control de
// escritura (canEdit=false, todos los botones desaparecen).
export function PayrollRolesPanel({ canEdit, canProposeFixedBonus, canApproveFixedBonus, isAdmin = false }: { canEdit: boolean; canProposeFixedBonus: boolean; canApproveFixedBonus: boolean; isAdmin?: boolean }) {
  const periods = useMemo(recentPeriods, []);
  const [period, setPeriod] = useState(currentPeriod);
  const [detail, setDetail] = useState<PeriodDetail | null>(null);
  const [transfer, setTransfer] = useState<Transfer | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [confirmingPublish, setConfirmingPublish] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [addingEmployeeId, setAddingEmployeeId] = useState<string | null>(null);

  const publishLabel = isEndOfMonthQuincena(period) ? "Generar rol de pago" : "Publicar";
  const pendingPayoutCount = detail?.roles.filter((r) => !r.paidAt).length ?? 0;

  function loadDetail() {
    fetch(`/api/payroll/periods/${period}`).then((r) => (r.ok ? r.json() : null)).then(setDetail);
  }
  useEffect(loadDetail, [period]);

  function loadTransfer() {
    fetch(`/api/payroll/periods/${period}/transfer`).then((r) => (r.ok ? r.json() : null)).then(setTransfer);
  }
  useEffect(loadTransfer, [period]);

  // Confirmado 2026-08-25: bug real encontrado por el usuario — editar las
  // líneas de un rol solo refrescaba `detail`, nunca `transfer`, así que el
  // "Total a transferir" se quedaba congelado con el monto de antes del
  // cambio mientras el período seguía en PENDING_APPROVAL (el backend sí
  // recalculaba `totalAmount`, pero el front nunca lo volvía a pedir).
  function refreshAfterRoleEdit() {
    loadDetail();
    loadTransfer();
  }

  async function generate() {
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/payroll/periods/${period}/generate`, { method: "POST" });
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) { setErr(data?.error ?? "No se pudo generar."); return; }
    loadDetail();
  }

  async function addMissingEmployee(employeeId: string) {
    setAddingEmployeeId(employeeId);
    setErr("");
    const res = await fetch(`/api/payroll/periods/${period}/add-employee`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeId }),
    });
    setAddingEmployeeId(null);
    const data = await res.json().catch(() => null);
    if (!res.ok) { setErr(data?.error ?? "No se pudo agregar."); return; }
    loadDetail();
  }

  async function publish() {
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/payroll/periods/${period}/publish`, { method: "POST" });
    setBusy(false);
    setConfirmingPublish(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) { setErr(data?.error ?? "No se pudo publicar."); return; }
    loadDetail();
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <select className="rounded border border-rule bg-surface px-2.5 py-2 text-[13px]" value={period} onChange={(e) => setPeriod(e.target.value)}>
          {periods.map((p) => (
            <option key={p} value={p}>{periodLabel(p)}</option>
          ))}
        </select>
        {detail?.status === "PUBLISHED" && (
          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-green bg-green/10 border border-green/30 rounded-full px-2.5 py-1">
            <ShieldCheck size={12} /> Publicado
          </span>
        )}
      </div>

      {err && <div className="text-red text-[12.5px] mb-3">{err}</div>}

      {(!detail || detail.status === "NOT_GENERATED") && canEdit && (
        <button type="button" disabled={busy} className="text-[12.5px] font-bold border border-rule rounded-md px-4 py-2 cursor-pointer disabled:opacity-60" onClick={generate}>
          {busy ? "Generando…" : "Generar roles de esta quincena"}
        </button>
      )}
      {(!detail || detail.status === "NOT_GENERATED") && (
        <div className="text-steel text-[12.5px] mt-2">Todavía no se generaron los roles de este período.</div>
      )}

      {detail && detail.status !== "NOT_GENERATED" && (
        <>
          {(!transfer || (isAdmin && transfer.status === "REJECTED")) && (
            <div className="bg-surface border border-rule rounded-md p-3.5 mb-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-2">Resumen de la quincena</div>
              <div className="flex items-center justify-between gap-2">
                <div className="text-[13px] font-bold">{periodLabel(period)}</div>
                <div className="flex flex-col items-end gap-0.5 bg-teal/15 border-2 border-teal/50 rounded-md px-3 py-1.5">
                  <div className="text-[24px] font-extrabold tabular-nums text-teal leading-none">{money(transfer?.totalAmount ?? detail.roles.reduce((s, r) => s + r.netTotal, 0))}</div>
                  <div className="text-[9.5px] text-teal/90 uppercase tracking-wide font-semibold">Total a transferir</div>
                </div>
              </div>
              {/* Confirmado 2026-08-24: pedido explícito del usuario — un envío
                  rechazado no debe quedar como una tarjeta grande dominando la
                  pantalla del admin (no hay nada que él tenga que hacer ahí,
                  la pelota está del lado de Nairoby). Se reduce a esta línea
                  y el resto (motivo completo, cuenta, botón de reenviar) sigue
                  viviendo en PayrollTransferPanel para quien sí puede actuar
                  (Nairoby, canEdit). */}
              {transfer?.status === "REJECTED" && (
                <div className="text-[11.5px] text-red mt-2 pt-2 border-t border-rule">
                  Rechazaste el envío anterior — {transfer.rejectionReason}. Esperando que Nairoby corrija y reenvíe.
                </div>
              )}
            </div>
          )}

          {/* Confirmado 2026-08-25: bug real encontrado por el usuario — esto
              exigía `transfer` (el objeto ya creado), así que cuando todavía
              no se había enviado nada (transfer === null) este panel nunca
              se montaba y el botón "Enviar total para transferir" (que vive
              en PayrollTransferPanel -> SendTotalPrompt para ese caso
              null+canEdit) quedaba inalcanzable. Ahora solo se excluye la
              espera inicial (undefined) y el caso admin+rechazado ya
              cubierto arriba. */}
          {transfer !== undefined && !(isAdmin && transfer?.status === "REJECTED") && (
            <PayrollTransferPanel period={period} isAdmin={isAdmin} canEdit={canEdit} transfer={transfer} onChanged={loadTransfer} />
          )}

          <button
            type="button"
            className="text-[11.5px] text-blue font-semibold cursor-pointer mb-2.5"
            onClick={() => setShowDetails((s) => !s)}
          >
            {showDetails ? "Ocultar" : "Desplegar"} detalles — sueldos, bonos y desglose por colaborador {showDetails ? "▴" : "▾"}
          </button>
          {showDetails && (
            <div className="mb-4">
              <PayrollEmployeeSalariesPanel canEdit={canEdit} canProposeBonus={canProposeFixedBonus} canApproveBonus={canApproveFixedBonus} />
              <CeoBonusesForNairobyPanel />

              <div className="bg-surface border border-rule rounded-md p-4 mb-4">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-2">Sueldo básico nacional</div>
                <div className="text-[15px] font-bold tabular-nums">$482.00</div>
                <span className="text-[11px] text-steel-dim block mt-1">Fijo por ahora — el cálculo de horas extra siempre usa este valor, sin excepción.</span>
              </div>

              {canEdit && detail.status === "DRAFT" && (detail.missingEmployees?.length ?? 0) > 0 && (
                <div className="bg-red/10 border border-red rounded-md p-3.5 mb-4">
                  <div className="text-[11.5px] font-semibold text-red mb-1.5">
                    Colaboradores sin rol en este período
                  </div>
                  <div className="text-[11px] text-steel mb-2.5">
                    Se les configuró sueldo en Nómina después de generar este período, así que no salieron incluidos. Agrégalos manualmente.
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {detail.missingEmployees!.map((e) => (
                      <div key={e.id} className="flex items-center justify-between gap-2 bg-cloud border border-rule rounded px-2.5 py-1.5">
                        <span className="text-[12.5px] text-ink">
                          {e.name}
                          {e.position && <span className="text-steel-dim"> — {e.position}</span>}
                        </span>
                        <button
                          type="button"
                          disabled={addingEmployeeId === e.id}
                          className="text-[11.5px] font-semibold text-blue cursor-pointer disabled:opacity-60"
                          onClick={() => addMissingEmployee(e.id)}
                        >
                          {addingEmployeeId === e.id ? "Agregando…" : "+ Agregar"}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="bg-surface border border-rule rounded-md p-3.5 mb-4">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-0.5">Resumen por colaborador</div>
                <div className="text-[13px] font-bold mb-2">{periodLabel(period)}</div>
                <div className="flex flex-col gap-1">
                  {detail.roles.map((r) => (
                    <div key={r.id} className="flex justify-between text-[12.5px]">
                      <span className="text-ink">{r.employee.name}</span>
                      <span className="font-semibold tabular-nums">{money(r.netTotal)}</span>
                    </div>
                  ))}
                </div>
                <div className="flex justify-between font-bold text-[13.5px] mt-2 pt-2 border-t border-rule">
                  <span>Total</span>
                  <span className="tabular-nums">{money(detail.roles.reduce((s, r) => s + r.netTotal, 0))}</span>
                </div>
              </div>

              <div className="flex flex-col gap-2.5">
                {detail.roles.map((r, i) => (
                  <RoleCard
                    key={r.id}
                    role={r}
                    index={i}
                    published={detail.status === "PUBLISHED"}
                    canEdit={canEdit}
                    monthlyRoleId={detail.monthlyRoleIdByEmployee?.[r.employeeId]}
                    showPayout={transfer?.status === "COMPLETED"}
                    onChanged={refreshAfterRoleEdit}
                  />
                ))}
              </div>
            </div>
          )}

          {detail.status === "DRAFT" && canEdit && transfer?.status === "COMPLETED" && pendingPayoutCount === 0 && (
            <div>
              {!confirmingPublish ? (
                <button type="button" className="text-[13px] font-bold bg-green text-white rounded-md px-4 py-2 cursor-pointer" onClick={() => setConfirmingPublish(true)}>
                  {publishLabel}
                </button>
              ) : (
                <div className="max-w-sm border-[1.5px] border-green rounded-md bg-cloud p-4">
                  <div className="text-[13px] font-bold mb-3">¿Seguro que está todo bien antes de {publishLabel.toLowerCase()}?</div>
                  <div className="flex gap-2">
                    <button type="button" className="text-[12px] font-semibold border border-rule rounded px-3 py-1.5 cursor-pointer" onClick={() => setConfirmingPublish(false)}>
                      No, seguir revisando
                    </button>
                    <button type="button" disabled={busy} className="text-[12px] font-bold bg-green text-white rounded px-3 py-1.5 cursor-pointer disabled:opacity-60" onClick={publish}>
                      {busy ? `${publishLabel}…` : `Sí, ${publishLabel.toLowerCase()}`}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          {detail.status === "DRAFT" && canEdit && transfer?.status === "COMPLETED" && pendingPayoutCount > 0 && (
            <div className="text-[12px] text-steel-dim italic">
              Todavía falta confirmar el comprobante individual de {pendingPayoutCount} colaborador{pendingPayoutCount === 1 ? "" : "es"} (ver arriba, en cada tarjeta) para poder {publishLabel.toLowerCase()}.
            </div>
          )}
          {detail.status === "DRAFT" && canEdit && transfer?.status !== "COMPLETED" && (
            <div className="text-[12px] text-steel-dim italic">
              {!transfer && "Enviá el total arriba para poder publicar — primero se paga, después se publica."}
              {transfer?.status === "PENDING_APPROVAL" && "Esperando que el admin apruebe la transferencia para poder publicar."}
              {transfer?.status === "REJECTED" && "El admin rechazó la transferencia — corregí y reenviá para poder publicar."}
              {transfer?.status === "APPROVED" && "Falta que el admin suba el comprobante de la transferencia para poder publicar."}
            </div>
          )}
        </>
      )}
    </div>
  );
}
