"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Check, X } from "lucide-react";

type EmployeeProfile = {
  id: string;
  name: string;
  position: string | null;
  department: { name: string } | null;
  payrollProfile: {
    realSalary: number | null;
    iessDeclaredSalary: number | null;
    companyAbsorbsIess: boolean;
    iessPartTime: boolean;
    canLogOvertimeHours: boolean;
    usesFullLegalOvertimeSchedule: boolean;
  } | null;
  fixedMonthlyBonus: {
    amount: number;
    pendingAmount: number | null;
    proposedBy: { name: string } | null;
  } | null;
};

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

// Confirmado 2026-08-17: pedido explícito del usuario — bono fijo mensual
// por persona, se suma al sueldo base con el mismo desfase de un mes que
// horas extra/comisiones. Nairoby propone, queda pendiente hasta que el
// admin lo aprueba — mismo patrón que TierCell en CommissionTiersPanel.tsx.
function FixedBonusCell({ employeeId, bonus, canPropose, canApprove, onSaved }: {
  employeeId: string;
  bonus: EmployeeProfile["fixedMonthlyBonus"];
  canPropose: boolean;
  canApprove: boolean;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(String(bonus?.pendingAmount ?? bonus?.amount ?? 0));
  const [busy, setBusy] = useState(false);
  const hasPending = bonus?.pendingAmount != null;

  async function propose() {
    const n = Number(value);
    if (n < 0 || Number.isNaN(n)) return;
    if (n === (bonus?.amount ?? 0) && !hasPending) return;
    setBusy(true);
    await fetch(`/api/payroll/fixed-bonus/${employeeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pendingAmount: n }),
    });
    setBusy(false);
    onSaved();
  }

  async function resolve(action: "approve" | "reject") {
    setBusy(true);
    await fetch(`/api/payroll/fixed-bonus/${employeeId}/${action}`, { method: "POST" });
    setBusy(false);
    onSaved();
  }

  return (
    <td className="py-2 pr-3">
      <input
        className={`rounded border px-2 py-1 text-[12px] w-24 disabled:opacity-70 ${hasPending ? "border-gold bg-gold/10" : "border-rule bg-cloud"}`}
        type="number"
        step="0.01"
        disabled={!canPropose || busy}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={propose}
      />
      {hasPending && (
        <div className="mt-1 text-[10px]">
          <div style={{ color: "#D9A441" }} className="font-semibold">
            Esperando aprobación (vigente: {money(bonus?.amount ?? 0)})
          </div>
          {canApprove && (
            <div className="flex items-center gap-2 mt-0.5">
              <button type="button" disabled={busy} className="flex items-center gap-0.5 text-green font-semibold cursor-pointer" onClick={() => resolve("approve")}>
                <Check size={11} /> Aprobar
              </button>
              <button type="button" disabled={busy} className="flex items-center gap-0.5 text-red font-semibold cursor-pointer" onClick={() => resolve("reject")}>
                <X size={11} /> Rechazar
              </button>
            </div>
          )}
        </div>
      )}
    </td>
  );
}

function SalaryRow({ employee, canEdit, canProposeBonus, canApproveBonus, onSaved }: {
  employee: EmployeeProfile;
  canEdit: boolean;
  canProposeBonus: boolean;
  canApproveBonus: boolean;
  onSaved: () => void;
}) {
  const p = employee.payrollProfile;
  const [realSalary, setRealSalary] = useState(p?.realSalary != null ? String(p.realSalary) : "");
  const [iessDeclaredSalary, setIessDeclaredSalary] = useState(p?.iessDeclaredSalary != null ? String(p.iessDeclaredSalary) : "");

  async function save(patch: Record<string, number | boolean>) {
    await fetch(`/api/payroll/profile/${employee.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    onSaved();
  }

  return (
    <tr className="border-b border-rule last:border-0">
      <td className="py-2 pr-3">
        <div className="font-semibold text-[12.5px]">{employee.name}</div>
        <div className="text-[10.5px] text-steel">
          {employee.department?.name ?? "—"}
          {employee.position ? ` · ${employee.position}` : ""}
        </div>
      </td>
      <td className="py-2 pr-3">
        <input
          className="rounded border border-rule bg-cloud px-2 py-1 text-[12px] w-24 disabled:opacity-70"
          type="number"
          step="0.01"
          disabled={!canEdit}
          value={realSalary}
          onChange={(e) => setRealSalary(e.target.value)}
          onBlur={() => { const n = Number(realSalary); if (n > 0) save({ realSalary: n }); }}
        />
      </td>
      <td className="py-2 pr-3">
        <input
          className="rounded border border-rule bg-cloud px-2 py-1 text-[12px] w-24 disabled:opacity-70"
          type="number"
          step="0.01"
          disabled={!canEdit}
          value={iessDeclaredSalary}
          onChange={(e) => setIessDeclaredSalary(e.target.value)}
          onBlur={() => { const n = Number(iessDeclaredSalary); if (n > 0) save({ iessDeclaredSalary: n }); }}
        />
      </td>
      <td className="py-2 pr-3 text-center">
        <input type="checkbox" disabled={!canEdit} checked={p?.companyAbsorbsIess ?? false} onChange={(e) => save({ companyAbsorbsIess: e.target.checked })} />
      </td>
      <td className="py-2 pr-3 text-center">
        <input type="checkbox" disabled={!canEdit} checked={p?.iessPartTime ?? false} onChange={(e) => save({ iessPartTime: e.target.checked })} />
      </td>
      <td className="py-2 pr-3 text-center">
        <input type="checkbox" disabled={!canEdit} checked={p?.canLogOvertimeHours ?? false} onChange={(e) => save({ canLogOvertimeHours: e.target.checked })} />
      </td>
      <td className="py-2 pr-3 text-center">
        <input type="checkbox" disabled={!canEdit} checked={p?.usesFullLegalOvertimeSchedule ?? false} onChange={(e) => save({ usesFullLegalOvertimeSchedule: e.target.checked })} />
      </td>
      <FixedBonusCell employeeId={employee.id} bonus={employee.fixedMonthlyBonus} canPropose={canProposeBonus} canApprove={canApproveBonus} onSaved={onSaved} />
    </tr>
  );
}

// Confirmado 2026-08-14: pedido explícito del usuario — ver y editar el
// sueldo de TODOS los colaboradores de un vistazo, sin entrar uno por uno a
// su perfil en "Colaboradores". Mismo dato/mismo endpoint que
// PayrollProfileFields.tsx (el bloque dentro del perfil individual) — esto
// es un segundo punto de entrada al mismo PayrollProfile, no un duplicado;
// editar desde cualquiera de los dos lados queda sincronizado al instante.
export function PayrollEmployeeSalariesPanel({ canEdit, canProposeBonus, canApproveBonus }: { canEdit: boolean; canProposeBonus: boolean; canApproveBonus: boolean }) {
  const [employees, setEmployees] = useState<EmployeeProfile[] | null>(null);
  const [open, setOpen] = useState(false);

  function load() {
    fetch("/api/payroll/employees").then((r) => (r.ok ? r.json() : [])).then(setEmployees);
  }
  useEffect(load, []);

  if (!employees) return null;

  return (
    <div className="bg-surface border border-rule rounded-md p-4 mb-4">
      <button type="button" className="flex items-center justify-between w-full cursor-pointer" onClick={() => setOpen((o) => !o)}>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-steel">Sueldos por colaborador ({employees.length})</div>
        {open ? <ChevronUp size={14} className="text-steel" /> : <ChevronDown size={14} className="text-steel" />}
      </button>

      {open && (
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10px] font-semibold uppercase tracking-wide text-steel border-b border-rule">
                <th className="pb-1.5 pr-3">Colaborador</th>
                <th className="pb-1.5 pr-3">Sueldo base</th>
                <th className="pb-1.5 pr-3">Declarado IESS</th>
                <th className="pb-1.5 pr-3 text-center">IESS 100%<br />Provedix</th>
                <th className="pb-1.5 pr-3 text-center">Tiempo<br />parcial</th>
                <th className="pb-1.5 pr-3 text-center">Horas<br />extra</th>
                <th className="pb-1.5 pr-3 text-center">Horario<br />legal</th>
                <th className="pb-1.5 pr-3">Bonos especiales<br />fijos</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => (
                <SalaryRow key={e.id} employee={e} canEdit={canEdit} canProposeBonus={canProposeBonus} canApproveBonus={canApproveBonus} onSaved={load} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!canEdit && <div className="text-[10.5px] text-steel-dim mt-2">Solo lectura.</div>}
    </div>
  );
}
