"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

type EmployeeProfile = {
  id: string;
  name: string;
  position: string | null;
  department: { name: string } | null;
  payrollProfile: {
    realSalary: number | null;
    iessDeclaredSalary: number | null;
    companyAbsorbsIess: boolean;
    canLogOvertimeHours: boolean;
    usesFullLegalOvertimeSchedule: boolean;
  } | null;
};

function SalaryRow({ employee, canEdit, onSaved }: { employee: EmployeeProfile; canEdit: boolean; onSaved: () => void }) {
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
        <input type="checkbox" disabled={!canEdit} checked={p?.canLogOvertimeHours ?? false} onChange={(e) => save({ canLogOvertimeHours: e.target.checked })} />
      </td>
      <td className="py-2 text-center">
        <input type="checkbox" disabled={!canEdit} checked={p?.usesFullLegalOvertimeSchedule ?? false} onChange={(e) => save({ usesFullLegalOvertimeSchedule: e.target.checked })} />
      </td>
    </tr>
  );
}

// Confirmado 2026-08-14: pedido explícito del usuario — ver y editar el
// sueldo de TODOS los colaboradores de un vistazo, sin entrar uno por uno a
// su perfil en "Colaboradores". Mismo dato/mismo endpoint que
// PayrollProfileFields.tsx (el bloque dentro del perfil individual) — esto
// es un segundo punto de entrada al mismo PayrollProfile, no un duplicado;
// editar desde cualquiera de los dos lados queda sincronizado al instante.
export function PayrollEmployeeSalariesPanel({ canEdit }: { canEdit: boolean }) {
  const [employees, setEmployees] = useState<EmployeeProfile[] | null>(null);
  const [open, setOpen] = useState(true);

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
                <th className="pb-1.5 pr-3">Sueldo real</th>
                <th className="pb-1.5 pr-3">Declarado IESS</th>
                <th className="pb-1.5 pr-3 text-center">IESS 100%<br />Provedix</th>
                <th className="pb-1.5 pr-3 text-center">Horas<br />extra</th>
                <th className="pb-1.5 text-center">Horario<br />legal</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => (
                <SalaryRow key={e.id} employee={e} canEdit={canEdit} onSaved={load} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!canEdit && <div className="text-[10.5px] text-steel-dim mt-2">Solo lectura.</div>}
    </div>
  );
}
