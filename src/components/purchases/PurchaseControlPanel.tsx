"use client";

import { useEffect, useState } from "react";
import { PurchaseRequestForm, DRAFT_KEY } from "./PurchaseRequestForm";
import { MyPurchaseRequests } from "./MyPurchaseRequests";
import { PurchaseApprovalInbox } from "./PurchaseApprovalInbox";
import { PurchaseReceivingPanel } from "./PurchaseReceivingPanel";
import { PurchaseInvoicingPanel } from "./PurchaseInvoicingPanel";
import { PurchasePriceExplorer } from "./PurchasePriceExplorer";
import { PurchaseUrgentReportsPanel } from "./PurchaseUrgentReportsPanel";
import { PurchaseAuditPanel } from "./PurchaseAuditPanel";
import { PurchaseCreditsPanel } from "./PurchaseCreditsPanel";

type Tab = "solicitar" | "mias" | "comparar" | "aprobacion" | "inventario" | "finanzas" | "urgentes" | "creditos" | "auditoria";

// Confirmado 2026-07-30: una sola pantalla para todo el módulo — las
// pestañas que ve cada persona dependen de lo que puede hacer (admin ve
// todas; Bryan/Nairoby ven Solicitar; Daniel ve Inventario; Nairoby además
// ve Finanzas) — igual que ya funciona Proveedores en /area y /admin.
export function PurchaseControlPanel({
  deptId,
  canSubmit,
  canReview,
  canReceive,
  canInvoice,
  isAdmin,
}: {
  deptId: string;
  canSubmit: boolean;
  canReview: boolean;
  canReceive: boolean;
  canInvoice: boolean;
  isAdmin: boolean;
}) {
  // Confirmado 2026-08-08: "Comparar precios" va primera de izquierda a
  // derecha (pedido explícito del usuario) — el orden visual es independiente
  // de qué pestaña abre por defecto (eso lo decide preferredDefault abajo).
  const tabs: { key: Tab; label: string }[] = [
    ...(canSubmit || canReview ? [{ key: "comparar" as Tab, label: "Comparar precios" }] : []),
    ...(canSubmit ? [{ key: "solicitar" as Tab, label: "Solicitar" }, { key: "mias" as Tab, label: "Mis solicitudes" }] : []),
    ...(canReview ? [{ key: "aprobacion" as Tab, label: "Bandeja de aprobación" }] : []),
    ...(canSubmit || canReview ? [{ key: "urgentes" as Tab, label: "Reportes urgentes" }] : []),
    ...(canSubmit || canReview ? [{ key: "creditos" as Tab, label: "Créditos pendientes" }] : []),
    ...(canReceive ? [{ key: "inventario" as Tab, label: "Inventario" }] : []),
    ...(canInvoice ? [{ key: "finanzas" as Tab, label: "Finanzas" }] : []),
    // Confirmado 2026-08-08 (ampliado 2026-08-12): historial de solo lectura
    // de todo lo confirmado recibido, para auditar sin poder editar nada —
    // ya no exclusivo del admin, cualquiera con acceso a este módulo
    // (Bryan/Daniel/Nairoby) también la ve, siempre en modo solo lectura.
    ...(isAdmin || canSubmit || canReceive || canInvoice ? [{ key: "auditoria" as Tab, label: "Auditoría" }] : []),
  ];
  const preferredDefault: Tab[] = ["solicitar", "aprobacion", "inventario", "finanzas", "mias", "comparar", "urgentes", "auditoria"];
  const [tab, setTab] = useState<Tab>(preferredDefault.find((k) => tabs.some((t) => t.key === k)) ?? tabs[0]?.key ?? "solicitar");

  // Confirmado 2026-08-13: pedido explícito del usuario — los links "Ir →"
  // de Pendientes en Inicio (ej. "Pagos de mercadería pendientes") llegan
  // con ?ptab=finanzas y deben abrir directo esa pestaña interna, sin pisar
  // el ?tab= que ya lee DeptWorkspaceTabs para la pestaña "Control de
  // Compras" en sí. Mismo patrón: se lee del URL directo, una sola vez.
  useEffect(() => {
    const ptab = new URLSearchParams(window.location.search).get("ptab");
    if (ptab && tabs.some((t) => t.key === ptab)) setTab(ptab as Tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (tabs.length === 0) {
    return <div className="text-steel text-[13.5px]">No tienes acceso a ninguna parte de Control de Compras.</div>;
  }

  // Confirmado 2026-08-07: "Corregir y reenviar" desde Mis solicitudes —
  // arma el borrador (mismo mecanismo que "retomar sin terminar" ya usa
  // PurchaseRequestForm) y salta a la pestaña Solicitar con todo pre-llenado.
  // El cambio de pestaña ya remonta PurchaseRequestForm (nunca coexisten:
  // solo se llega aquí desde "Mis solicitudes"), así que no hace falta
  // ningún truco extra para forzar que corra su restauración de borrador.
  function handleResubmit(draft: unknown) {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    setTab("solicitar");
  }

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

      {tab === "solicitar" && <PurchaseRequestForm deptId={deptId} isAdmin={isAdmin} />}
      {tab === "mias" && <MyPurchaseRequests onResubmit={handleResubmit} isAdmin={isAdmin} />}
      {tab === "comparar" && <PurchasePriceExplorer />}
      {tab === "aprobacion" && <PurchaseApprovalInbox />}
      {tab === "urgentes" && <PurchaseUrgentReportsPanel isAdmin={isAdmin} />}
      {tab === "creditos" && <PurchaseCreditsPanel />}
      {tab === "inventario" && <PurchaseReceivingPanel isAdmin={isAdmin} />}
      {tab === "finanzas" && <PurchaseInvoicingPanel />}
      {tab === "auditoria" && <PurchaseAuditPanel />}
    </div>
  );
}
