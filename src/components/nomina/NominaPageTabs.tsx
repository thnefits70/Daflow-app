"use client";

import { useEffect, useState } from "react";
import { NominaGrid } from "./NominaGrid";
import { PayrollWorkspace } from "./PayrollWorkspace";
import { PayStubsPanel } from "@/components/payroll/PayStubsPanel";

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

type Tab = "colaboradores" | "pagos" | "rolesdepago";

// Confirmado 2026-08-13: pedido explícito del usuario — la calculadora de
// roles de pago vive dentro de esta misma sección "Nómina" que ya existía,
// como una pestaña más al lado del directorio de colaboradores.
// Ampliado 2026-08-21: pedido explícito del usuario — la sección "Roles de
// pago" (comprobantes/PDFs) del admin, antes un ítem de sidebar aparte, se
// consolida acá también como pestaña, en vez de pantalla independiente.
export function NominaPageTabs({
  users,
  departments,
  payStubDepartments,
  basePath,
  canManage = true,
  canLogOvertime,
  canApproveOvertime,
  canViewRoles,
  canEditRoles,
  canProposeCommissions,
  canApproveCommissions,
  canGrantCeoBonus,
  canConfirmPersonalPurchaseFinance,
  canManageSalaryAdvances,
  canCreateManagementDeduction,
  canManagePayStubs = false,
  isAdmin = false,
}: {
  users: NominaUser[];
  departments: Dept[];
  payStubDepartments?: Dept[];
  basePath?: string;
  canManage?: boolean;
  canLogOvertime: boolean;
  canApproveOvertime: boolean;
  canViewRoles: boolean;
  canEditRoles: boolean;
  canProposeCommissions: boolean;
  canApproveCommissions: boolean;
  canGrantCeoBonus: boolean;
  canConfirmPersonalPurchaseFinance: boolean;
  canManageSalaryAdvances: boolean;
  canCreateManagementDeduction: boolean;
  canManagePayStubs?: boolean;
  isAdmin?: boolean;
}) {
  const showPayrollTab =
    canLogOvertime || canApproveOvertime || canViewRoles || canProposeCommissions || canGrantCeoBonus ||
    canConfirmPersonalPurchaseFinance || canManageSalaryAdvances || canCreateManagementDeduction;

  const tabs: { key: Tab; label: string }[] = [
    ...(canManage ? [{ key: "colaboradores" as Tab, label: "Colaboradores" }] : []),
    ...(showPayrollTab ? [{ key: "pagos" as Tab, label: "Pagos y horas extra" }] : []),
    ...(canManagePayStubs ? [{ key: "rolesdepago" as Tab, label: "Roles de pago" }] : []),
  ];
  const [tab, setTab] = useState<Tab>(tabs[0]?.key ?? "colaboradores");

  // Confirmado 2026-08-14: pedido explícito del usuario — el atajo "Ir →"
  // de Pendientes en Inicio ("Horas extra por aprobar") llega con
  // ?tab=pagos y debe abrir directo esa pestaña, sin necesidad de un
  // segundo nivel — PayrollWorkspace ya arranca en "Aprobar horas extra"
  // para el admin (es la primera pestaña que tiene disponible).
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (tabs.some((x) => x.key === t)) setTab(t as Tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (tabs.length === 0) return null;

  return (
    <div>
      {tabs.length > 1 && (
        <div className="flex gap-5.5 border-b border-rule mb-5.5">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`pb-2.5 text-[13px] font-semibold border-b-2 cursor-pointer ${tab === t.key ? "text-ink border-teal" : "text-steel border-transparent hover:text-ink"}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {tab === "colaboradores" && canManage && <NominaGrid users={users} departments={departments} basePath={basePath} />}
      {tab === "pagos" && showPayrollTab && (
        <PayrollWorkspace
          canLogOvertime={canLogOvertime}
          canApproveOvertime={canApproveOvertime}
          canViewRoles={canViewRoles}
          canEditRoles={canEditRoles}
          canProposeCommissions={canProposeCommissions}
          canApproveCommissions={canApproveCommissions}
          canGrantCeoBonus={canGrantCeoBonus}
          canConfirmPersonalPurchaseFinance={canConfirmPersonalPurchaseFinance}
          canManageSalaryAdvances={canManageSalaryAdvances}
          canCreateManagementDeduction={canCreateManagementDeduction}
          isAdmin={isAdmin}
        />
      )}
      {tab === "rolesdepago" && canManagePayStubs && (
        <PayStubsPanel mode="manage" departments={payStubDepartments} isAdmin={isAdmin} />
      )}
    </div>
  );
}
