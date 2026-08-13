"use client";

import { useState } from "react";
import { NominaGrid } from "./NominaGrid";
import { PayrollWorkspace } from "./PayrollWorkspace";

type Dept = { id: string; name: string; code: string };
type NominaUser = {
  id: string;
  name: string;
  username: string;
  position: string | null;
  photoUrl: string | null;
  deptId: string | null;
  department: Dept | null;
  isLeader: boolean;
  leadsDeptId: string | null;
  isActive: boolean;
};

// Confirmado 2026-08-13: pedido explícito del usuario — la calculadora de
// roles de pago vive dentro de esta misma sección "Nómina" que ya existía,
// como una pestaña más al lado del directorio de colaboradores.
export function NominaPageTabs({
  users,
  departments,
  basePath,
  canManage = true,
  canLogOvertime,
  canApproveOvertime,
  canViewRoles,
  canEditRoles,
}: {
  users: NominaUser[];
  departments: Dept[];
  basePath?: string;
  canManage?: boolean;
  canLogOvertime: boolean;
  canApproveOvertime: boolean;
  canViewRoles: boolean;
  canEditRoles: boolean;
}) {
  const showPayrollTab = canLogOvertime || canApproveOvertime || canViewRoles;
  const [tab, setTab] = useState<"colaboradores" | "pagos">(canManage ? "colaboradores" : "pagos");

  if (canManage && !showPayrollTab) return <NominaGrid users={users} departments={departments} basePath={basePath} />;
  if (!canManage && showPayrollTab) {
    return (
      <PayrollWorkspace
        canLogOvertime={canLogOvertime}
        canApproveOvertime={canApproveOvertime}
        canViewRoles={canViewRoles}
        canEditRoles={canEditRoles}
      />
    );
  }

  return (
    <div>
      <div className="flex gap-5.5 border-b border-rule mb-5.5">
        {canManage && (
          <button
            type="button"
            className={`pb-2.5 text-[13px] font-semibold border-b-2 cursor-pointer ${tab === "colaboradores" ? "text-ink border-teal" : "text-steel border-transparent hover:text-ink"}`}
            onClick={() => setTab("colaboradores")}
          >
            Colaboradores
          </button>
        )}
        <button
          type="button"
          className={`pb-2.5 text-[13px] font-semibold border-b-2 cursor-pointer ${tab === "pagos" ? "text-ink border-teal" : "text-steel border-transparent hover:text-ink"}`}
          onClick={() => setTab("pagos")}
        >
          Pagos y horas extra
        </button>
      </div>

      {tab === "colaboradores" && <NominaGrid users={users} departments={departments} basePath={basePath} />}
      {tab === "pagos" && (
        <PayrollWorkspace
          canLogOvertime={canLogOvertime}
          canApproveOvertime={canApproveOvertime}
          canViewRoles={canViewRoles}
          canEditRoles={canEditRoles}
        />
      )}
    </div>
  );
}
