"use client";

import { useEffect, useState } from "react";
import { ExternalPaymentsPanel } from "@/components/payroll/ExternalPaymentsPanel";

type Tab = "roles" | "factura";

// Confirmado 2026-09-09: pedido explícito del usuario — separar el control
// de quien está en modo de pago externo (factura/comprobante) del Rol de
// pago formal, sin perder el mismo lugar de siempre (/area/roles-de-pago).
export function RolesDePagoTabs({ canEditExternal, payStubsPanel }: { canEditExternal: boolean; payStubsPanel: React.ReactNode }) {
  const [tab, setTab] = useState<Tab>("roles");

  // El aviso de "Pagos por factura/comprobante" en Inicio enlaza con
  // ?ptab=factura para abrir directo esa pestaña.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("ptab") === "factura") setTab("factura");
  }, []);

  return (
    <div>
      <div className="flex gap-5.5 border-b border-rule mb-5.5">
        {([
          { key: "roles" as Tab, label: "Rol formal" },
          { key: "factura" as Tab, label: "Pagos por factura" },
        ]).map((t) => (
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
      {tab === "roles" && payStubsPanel}
      {tab === "factura" && <ExternalPaymentsPanel canEdit={canEditExternal} />}
    </div>
  );
}
