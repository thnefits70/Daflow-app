"use client";

import { useState } from "react";
import { OvertimeEntryPanel } from "./OvertimeEntryPanel";
import { OvertimeApprovalPanel } from "./OvertimeApprovalPanel";
import { PayrollRolesPanel } from "./PayrollRolesPanel";

type Tab = "horas" | "aprobar" | "roles";

// Confirmado 2026-08-13: pedido explícito del usuario — todo esto vive
// dentro de la misma sección "Nómina" que ya existía, como pestañas nuevas,
// no una pantalla aparte.
export function PayrollWorkspace({
  canLogOvertime,
  canApproveOvertime,
  canViewRoles,
  canEditRoles,
}: {
  canLogOvertime: boolean;
  canApproveOvertime: boolean;
  canViewRoles: boolean;
  canEditRoles: boolean;
}) {
  const tabs: { key: Tab; label: string }[] = [
    ...(canLogOvertime ? [{ key: "horas" as Tab, label: "Registrar horas extra" }] : []),
    ...(canApproveOvertime ? [{ key: "aprobar" as Tab, label: "Aprobar horas extra" }] : []),
    ...(canViewRoles ? [{ key: "roles" as Tab, label: "Rol de pago" }] : []),
  ];
  const [tab, setTab] = useState<Tab>(tabs[0]?.key ?? "roles");

  if (tabs.length === 0) return null;

  return (
    <div>
      <div className="flex gap-5.5 border-b border-rule mb-5.5 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`pb-2.5 text-[13px] font-semibold border-b-2 cursor-pointer whitespace-nowrap ${tab === t.key ? "text-ink border-teal" : "text-steel border-transparent hover:text-ink"}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "horas" && canLogOvertime && <OvertimeEntryPanel />}
      {tab === "aprobar" && canApproveOvertime && <OvertimeApprovalPanel />}
      {tab === "roles" && canViewRoles && <PayrollRolesPanel canEdit={canEditRoles} />}
    </div>
  );
}
