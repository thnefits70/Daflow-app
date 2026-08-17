"use client";

import { useEffect, useState } from "react";
import { Wallet } from "lucide-react";

type Profile = {
  realSalary: number | null;
  iessDeclaredSalary: number | null;
  companyAbsorbsIess: boolean;
  canLogOvertimeHours: boolean;
  usesFullLegalOvertimeSchedule: boolean;
};

function ToggleRow({ label, hint, value, onChange, disabled }: { label: string; hint: string; value: boolean; onChange: (v: boolean) => void; disabled: boolean }) {
  return (
    <div className="mt-3">
      <div className="text-[11.5px] font-semibold text-ink">{label}</div>
      <div className="text-[10.5px] text-steel mb-1.5">{hint}</div>
      <div className="flex border border-rule rounded overflow-hidden max-w-[180px]">
        <button type="button" disabled={disabled} className={`flex-1 py-1.5 text-[12px] font-semibold cursor-pointer disabled:cursor-default ${value ? "bg-blue text-white" : "bg-surface text-steel"}`} onClick={() => onChange(true)}>
          Sí
        </button>
        <button type="button" disabled={disabled} className={`flex-1 py-1.5 text-[12px] font-semibold cursor-pointer disabled:cursor-default ${!value ? "bg-blue text-white" : "bg-surface text-steel"}`} onClick={() => onChange(false)}>
          No
        </button>
      </div>
    </div>
  );
}

// Confirmado 2026-08-13: pedido explícito del usuario — sueldo real,
// declarado en el IESS, y los 3 interruptores de la calculadora de Nómina.
// Exclusivo de Nairoby Castro para editar; el admin ve exactamente esto de
// solo lectura (canEdit=false); nadie más ve esta sección.
export function PayrollProfileFields({ userId, canEdit }: { userId: string; canEdit: boolean }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [realSalary, setRealSalary] = useState("");
  const [iessDeclaredSalary, setIessDeclaredSalary] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/payroll/profile/${userId}`).then((r) => (r.ok ? r.json() : null)).then((p: Profile) => {
      setProfile(p);
      setRealSalary(p.realSalary != null ? String(p.realSalary) : "");
      setIessDeclaredSalary(p.iessDeclaredSalary != null ? String(p.iessDeclaredSalary) : "");
    });
  }, [userId]);

  async function save(patch: Partial<{ realSalary: number; iessDeclaredSalary: number; companyAbsorbsIess: boolean; canLogOvertimeHours: boolean; usesFullLegalOvertimeSchedule: boolean }>) {
    setSaving(true);
    const res = await fetch(`/api/payroll/profile/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    setSaving(false);
    if (res.ok) setProfile(await res.json());
  }

  if (!profile) return null;

  return (
    <div className="bg-cloud border border-rule rounded p-3.5 mt-3.5">
      <label className="flex items-center gap-1 mb-2 text-[10.5px] font-semibold uppercase tracking-wide text-steel">
        <Wallet size={11} /> Nómina — sueldo y horas extra
      </label>
      <div className="text-[11px] text-steel mb-2">
        Datos sensibles de sueldo — {canEdit ? "solo vos podés editarlos" : "de solo lectura, exclusivo de Nairoby Castro para editar"}.
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-steel mb-1">Sueldo base</div>
          <input
            className="rounded border border-rule bg-surface px-2.5 py-1.5 text-[13px] w-full disabled:opacity-70"
            type="number"
            step="0.01"
            disabled={!canEdit}
            value={realSalary}
            onChange={(e) => setRealSalary(e.target.value)}
            onBlur={() => { const n = Number(realSalary); if (n > 0) save({ realSalary: n }); }}
          />
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-steel mb-1">Declarado en el IESS</div>
          <input
            className="rounded border border-rule bg-surface px-2.5 py-1.5 text-[13px] w-full disabled:opacity-70"
            type="number"
            step="0.01"
            disabled={!canEdit}
            value={iessDeclaredSalary}
            onChange={(e) => setIessDeclaredSalary(e.target.value)}
            onBlur={() => { const n = Number(iessDeclaredSalary); if (n > 0) save({ iessDeclaredSalary: n }); }}
          />
        </div>
      </div>

      <ToggleRow
        label="Provedix asume su IESS al 100%"
        hint="No se le descuenta nada de IESS en su rol (hoy: Andrés y Marcos)."
        value={profile.companyAbsorbsIess}
        onChange={(v) => save({ companyAbsorbsIess: v })}
        disabled={!canEdit}
      />
      <ToggleRow
        label="Puede registrar horas extra"
        hint="Le habilita la pantalla para cargar sus horas extra y las de su equipo (hoy: Inventario y Fulfillment)."
        value={profile.canLogOvertimeHours}
        onChange={(v) => save({ canLogOvertimeHours: v })}
        disabled={!canEdit}
      />
      <ToggleRow
        label="Usa horario legal completo"
        hint="Cuenta extra después de las 5pm entre semana y todo el sábado 8:30-12:30, en vez del umbral por defecto (6:30pm)."
        value={profile.usesFullLegalOvertimeSchedule}
        onChange={(v) => save({ usesFullLegalOvertimeSchedule: v })}
        disabled={!canEdit}
      />
      {saving && <div className="text-[10.5px] text-steel-dim mt-2">Guardando…</div>}
    </div>
  );
}
