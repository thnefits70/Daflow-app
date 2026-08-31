"use client";

import { useEffect, useState } from "react";
import { OvertimeEntryPanel } from "./OvertimeEntryPanel";
import { OvertimeApprovalPanel } from "./OvertimeApprovalPanel";
import { OvertimeHistoryPanel } from "./OvertimeHistoryPanel";
import { PayrollRolesPanel } from "./PayrollRolesPanel";
import { PayrollPaymentHistoryPanel } from "./PayrollPaymentHistoryPanel";
import { CommissionTiersPanel } from "./CommissionTiersPanel";
import { CeoBonusesPanel } from "./CeoBonusesPanel";
import { PersonalPurchasesFinancePanel } from "@/components/personal-purchases/PersonalPurchasesFinancePanel";
import { PersonalPurchasesTransferPanel } from "@/components/personal-purchases/PersonalPurchasesTransferPanel";
import { PersonalPurchasesPaymentWatchPanel } from "@/components/personal-purchases/PersonalPurchasesPaymentWatchPanel";
import { PersonalPurchasesPaymentLedgerPanel } from "@/components/personal-purchases/PersonalPurchasesPaymentLedgerPanel";
import { PersonalPurchasesHistoryPanel } from "@/components/personal-purchases/PersonalPurchasesHistoryPanel";
import { SalaryAdvanceApprovalPanel } from "@/components/salary-advances/SalaryAdvanceApprovalPanel";
import { ManagementDeductionsPanel } from "./ManagementDeductionsPanel";
import { TabGuide } from "@/components/shared/TabGuide";

type Tab = "horas" | "aprobar" | "historial" | "roles" | "historialpagos" | "comisiones" | "bonosceo" | "comprasfinanzas" | "anticipos" | "descuentos";

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
  isAdmin = false,
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
  isAdmin?: boolean;
}) {
  const tabs: { key: Tab; label: string }[] = [
    ...(canLogOvertime ? [{ key: "horas" as Tab, label: "Registrar horas extra" }] : []),
    ...(canApproveOvertime ? [{ key: "aprobar" as Tab, label: "Aprobar horas extra" }] : []),
    ...(canViewRoles ? [{ key: "historial" as Tab, label: "Historial de horas extra" }] : []),
    ...(canViewRoles ? [{ key: "roles" as Tab, label: "Rol de pago" }] : []),
    ...(canViewRoles ? [{ key: "historialpagos" as Tab, label: "Historial de pagos" }] : []),
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

      {tab === "horas" && canLogOvertime && (
        <>
          <TabGuide storageKey="nomina-horas">
            Registra acá las horas extra de tu equipo, día por día. Quedan pendientes de aprobación del admin antes de contar para el cálculo del rol.
          </TabGuide>
          <OvertimeEntryPanel />
        </>
      )}
      {tab === "aprobar" && canApproveOvertime && (
        <>
          <TabGuide storageKey="nomina-aprobar">
            Aprueba día por día las horas extra que reportan los líderes. Sin tu aprobación, ninguna hora cuenta para el cálculo del rol de pago.
          </TabGuide>
          <OvertimeApprovalPanel />
        </>
      )}
      {tab === "historial" && canViewRoles && (
        <>
          <TabGuide storageKey="nomina-historial">
            Consulta acá el historial completo de horas extra ya aprobadas, para revisar o auditar.
          </TabGuide>
          <OvertimeHistoryPanel />
        </>
      )}
      {tab === "roles" && canViewRoles && (
        <>
          <TabGuide storageKey="nomina-roles">
            {canEditRoles ? (
              <>Acá se arma el rol de pago de cada quincena: genera los roles, agrega conceptos (bonos, descuentos, anticipos), envía el total a transferir y publícalo cuando el admin confirme el pago. Cada colaborador solo ve su propio &quot;Rol del mes&quot; simplificado.</>
            ) : (
              <>Vista de solo lectura del rol de pago de la quincena. Armar los roles, agregar conceptos y publicar es exclusivo de Nairoby — tu parte es aprobar o rechazar la transferencia y subir el comprobante cuando corresponda.</>
            )}
          </TabGuide>
          <PayrollRolesPanel canEdit={canEditRoles} canProposeFixedBonus={canProposeCommissions} canApproveFixedBonus={canApproveCommissions} isAdmin={isAdmin} />
        </>
      )}
      {tab === "historialpagos" && canViewRoles && (
        <>
          <TabGuide storageKey="nomina-historialpagos">
            Registro mensual de los pagos individuales que se van confirmando en cada quincena — quién ya está pagado y quién falta, con su comprobante. Solo Nairoby y el admin lo ven.
          </TabGuide>
          <PayrollPaymentHistoryPanel />
        </>
      )}
      {tab === "comisiones" && canProposeCommissions && (
        <>
          <TabGuide storageKey="nomina-comisiones">
            {canApproveCommissions ? (
              <>Aprueba los montos de comisión que Nairoby propone por colaborador y nivel (Raíz/Cosecha/Provedix, según el promedio de pedidos/día del mes). Sin tu aprobación, ningún monto propuesto cuenta para el rol de pago.</>
            ) : (
              <>Propón acá el monto de comisión de cada colaborador según el nivel que alcanzó (Raíz/Cosecha/Provedix). Queda pendiente hasta que el admin lo apruebe.</>
            )}
          </TabGuide>
          <CommissionTiersPanel canPropose={canProposeCommissions} canApprove={canApproveCommissions} />
        </>
      )}
      {tab === "bonosceo" && canGrantCeoBonus && (
        <>
          <TabGuide storageKey="nomina-bonosceo">
            Elige a quién quieres reconocer y el tipo de bono — el monto es fijo por tipo. Al otorgarlo queda aprobado al instante: se le notifica y entra directo a su rol de pago.
          </TabGuide>
          <CeoBonusesPanel />
        </>
      )}
      {tab === "comprasfinanzas" && canConfirmPersonalPurchaseFinance && (
        <div className="flex flex-col gap-5">
          <TabGuide storageKey="nomina-comprasfinanzas">
            {isAdmin ? (
              <>Confirma acá que llegó el pago de un colaborador por su compra personal (dos pasos: &quot;Confirmar recibido&quot; y confirmar de nuevo en el cartel), revisando tu cuenta real. Una vez confirmado, se cierra y el colaborador puede pasar a retirar.</>
            ) : (
              <>Pon el precio en dólares de cada compra personal que Daniel ya confirmó (costo y Dropi según corresponda, en las cuotas que decidas). Una vez que el admin confirme que llegó el pago, cierra la operación desde acá para habilitar el retiro.</>
            )}
          </TabGuide>
          <PersonalPurchasesPaymentWatchPanel />
          <PersonalPurchasesPaymentLedgerPanel />
          <PersonalPurchasesFinancePanel isAdmin={isAdmin} />
          <PersonalPurchasesTransferPanel isAdmin={isAdmin} />
          <PersonalPurchasesHistoryPanel />
        </div>
      )}
      {tab === "anticipos" && canManageSalaryAdvances && (
        <>
          <TabGuide storageKey="nomina-anticipos">
            Aprueba o rechaza acá los anticipos de sueldo que piden los colaboradores. Al aprobar, sube el comprobante de pago a la cuenta bancaria que ya tienen registrada.
          </TabGuide>
          <SalaryAdvanceApprovalPanel />
        </>
      )}
      {tab === "descuentos" && canCreateManagementDeduction && (
        <>
          <TabGuide storageKey="nomina-descuentos">
            Crea acá un descuento administrativo a un colaborador, con motivo y evidencia. No se aplica al rol de pago hasta que el colaborador lo acepte explícitamente.
          </TabGuide>
          <ManagementDeductionsPanel />
        </>
      )}
    </div>
  );
}
