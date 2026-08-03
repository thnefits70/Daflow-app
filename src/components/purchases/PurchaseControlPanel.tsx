"use client";

import { useState } from "react";
import { PurchaseRequestForm } from "./PurchaseRequestForm";
import { MyPurchaseRequests } from "./MyPurchaseRequests";
import { PurchaseApprovalInbox } from "./PurchaseApprovalInbox";
import { PurchaseReceivingPanel } from "./PurchaseReceivingPanel";
import { PurchaseInvoicingPanel } from "./PurchaseInvoicingPanel";
import { PurchasePriceExplorer } from "./PurchasePriceExplorer";

type Tab = "solicitar" | "mias" | "comparar" | "aprobacion" | "inventario" | "finanzas";

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
  const tabs: { key: Tab; label: string }[] = [
    ...(canSubmit ? [{ key: "solicitar" as Tab, label: "Solicitar" }, { key: "mias" as Tab, label: "Mis solicitudes" }] : []),
    ...(canSubmit || canReview ? [{ key: "comparar" as Tab, label: "Comparar precios" }] : []),
    ...(canReview ? [{ key: "aprobacion" as Tab, label: "Bandeja de aprobación" }] : []),
    ...(canReceive ? [{ key: "inventario" as Tab, label: "Inventario" }] : []),
    ...(canInvoice ? [{ key: "finanzas" as Tab, label: "Finanzas" }] : []),
  ];
  const [tab, setTab] = useState<Tab>(tabs[0]?.key ?? "solicitar");

  if (tabs.length === 0) {
    return <div className="text-steel text-[13.5px]">No tienes acceso a ninguna parte de Control de Compras.</div>;
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
      {tab === "mias" && <MyPurchaseRequests />}
      {tab === "comparar" && <PurchasePriceExplorer />}
      {tab === "aprobacion" && <PurchaseApprovalInbox />}
      {tab === "inventario" && <PurchaseReceivingPanel />}
      {tab === "finanzas" && <PurchaseInvoicingPanel />}
    </div>
  );
}
