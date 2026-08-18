"use client";

import { useEffect, useState } from "react";
import { OvertimeEntryPanel } from "./OvertimeEntryPanel";
import { OvertimeApprovalPanel } from "./OvertimeApprovalPanel";
import { OvertimeHistoryPanel } from "./OvertimeHistoryPanel";
import { PayrollRolesPanel } from "./PayrollRolesPanel";
import { CommissionTiersPanel } from "./CommissionTiersPanel";
import { CeoBonusesPanel } from "./CeoBonusesPanel";
import { PersonalPurchasesFinancePanel } from "@/components/personal-purchases/PersonalPurchasesFinancePanel";
import { RetailProductCatalogPanel } from "@/components/personal-purchases/RetailProductCatalogPanel";
import { SalaryAdvanceApprovalPanel } from "@/components/salary-advances/SalaryAdvanceApprovalPanel";
import { ManagementDeductionsPanel } from "./ManagementDeductionsPanel";

type Tab = "horas" | "aprobar" | "historial" | "roles" | "comisiones" | "bonosceo" | "comprasfinanzas" | "anticipos" | "descuentos";

// Confirmado 2026-08-13: pedido explícito del usuario — todo esto vive
// dentro de la misma sección "Nómina" que ya existía, como pestañas nuevas,
// no una pantalla aparte. Ampliado 2026-08-14 con Comisiones de equipo
// (Nairoby propone, admin aprueba) y Bonos discrecionales (admin-only).
export function PayrollWorkspace({
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
}: {
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
}) {
  const tabs: { key: Tab; label: string }[] = [
    ...(canLogOvertime ? [{ key: "horas" as Tab, label: "Registrar horas extra" }] : []),
    ...(canApproveOvertime ? [{ key: "aprobar" as Tab, label: "Aprobar horas extra" }] : []),
    ...(canViewRoles ? [{ key: "historial" as Tab, label: "Historial de horas extra" }] : []),
    ...(canViewRoles ? [{ key: "roles" as Tab, label: "Rol de pago" }] : []),
    ...(canProposeCommissions ? [{ key: "comisiones" as Tab, label: "Comisiones de equipo" }] : []),
    ...(canGrantCeoBonus ? [{ key: "bonosceo" as Tab, label: "Bonos discrecionales" }] : []),
    ...(canConfirmPersonalPurchaseFinance ? [{ key: "comprasfinanzas" as Tab, label: "Compras personales" }] : []),
    ...(canManageSalaryAdvances ? [{ key: "anticipos" as Tab, label: "Anticipos" }] : []),
    ...(canCreateManagementDeduction ? [{ key: "descuentos" as Tab, label: "Descuentos" }] : []),
  ];
  const [tab, setTab] = useState<Tab>(tabs[0]?.key ?? "roles");

  // Confirmado 2026-08-18: pedido explícito del usuario — el atajo "Ir →" de
  // Pendientes en Inicio ("Comisiones y bonos por aprobar", "Compras
  // personales por confirmar", "Anticipos pendientes", "Descuentos por
  // aceptar") llega con ?tab=pagos&ptab=X y debe abrir directo esa
  // sub-pestaña, mismo espíritu que el "tab=pagos" que ya lee NominaPageTabs.
  useEffect(() => {
    const ptab = new URLSearchParams(window.location.search).get("ptab");
    if (tabs.some((t) => t.key === ptab)) setTab(ptab as Tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      {tab === "historial" && canViewRoles && <OvertimeHistoryPanel />}
      {tab === "roles" && canViewRoles && (
        <PayrollRolesPanel canEdit={canEditRoles} canProposeFixedBonus={canProposeCommissions} canApproveFixedBonus={canApproveCommissions} />
      )}
      {tab === "comisiones" && canProposeCommissions && <CommissionTiersPanel canPropose={canProposeCommissions} canApprove={canApproveCommissions} />}
      {tab === "bonosceo" && canGrantCeoBonus && <CeoBonusesPanel />}
      {tab === "comprasfinanzas" && canConfirmPersonalPurchaseFinance && (
        <div>
          <PersonalPurchasesFinancePanel />
          <div className="mt-5">
            <RetailProductCatalogPanel />
          </div>
        </div>
      )}
      {tab === "anticipos" && canManageSalaryAdvances && <SalaryAdvanceApprovalPanel />}
      {tab === "descuentos" && canCreateManagementDeduction && <ManagementDeductionsPanel />}
    </div>
  );
}
