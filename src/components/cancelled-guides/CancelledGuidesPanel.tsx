"use client";

import { useState } from "react";
import { CancelledGuideSubmitForm } from "./CancelledGuideSubmitForm";
import { CancelledGuideBatchInbox } from "./CancelledGuideBatchInbox";
import { CancelledGuideItemAssignmentPanel } from "./CancelledGuideItemAssignmentPanel";
import { CancelledGuideReingresoQueue } from "./CancelledGuideReingresoQueue";
import { CancelledGuideHistoryList } from "./CancelledGuideHistoryList";
import { TabGuide } from "@/components/shared/TabGuide";

type Tab = "reportar" | "lotes" | "productos" | "reingreso" | "historial";

export function CancelledGuidesPanel({
  canSubmit,
  canManageBatches,
  canAssignItems,
  canReingreso,
}: {
  canSubmit: boolean;
  canManageBatches: boolean;
  canAssignItems: boolean;
  canReingreso: boolean;
}) {
  const defaultTab: Tab = canSubmit ? "reportar" : canManageBatches ? "lotes" : canAssignItems ? "productos" : canReingreso ? "reingreso" : "historial";
  const [tab, setTab] = useState<Tab>(defaultTab);

  const tabs: { id: Tab; label: string }[] = [
    ...(canSubmit ? [{ id: "reportar" as const, label: "Reportar" }] : []),
    ...(canManageBatches ? [{ id: "lotes" as const, label: "Gestionar lotes" }] : []),
    ...(canAssignItems ? [{ id: "productos" as const, label: "Cargar productos" }] : []),
    ...(canReingreso ? [{ id: "reingreso" as const, label: "Reingresar a Just" }] : []),
    { id: "historial" as const, label: "Historial" },
  ];

  return (
    <div>
      <div className="flex gap-5 border-b border-rule mb-4 flex-wrap">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`pb-2 text-[12.5px] font-semibold cursor-pointer border-b-2 ${tab === t.id ? "border-teal text-ink" : "border-transparent text-steel hover:text-ink"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "reportar" && canSubmit && (
        <>
          <TabGuide storageKey="cancelledguides-reportar">Reporta acá las guías que hay que cancelar — Fulfillment e Inventario se enteran al toque para no despacharlas, y Análisis de Mercado recibe el lote para gestionarlo con la transportadora.</TabGuide>
          <CancelledGuideSubmitForm />
        </>
      )}
      {tab === "lotes" && canManageBatches && (
        <>
          <TabGuide storageKey="cancelledguides-lotes">Copiá las guías de cada lote y gestioná la cancelación con la transportadora/Dropi. Cuando ya lo hiciste, confirmá el lote completo.</TabGuide>
          <CancelledGuideBatchInbox />
        </>
      )}
      {tab === "productos" && canAssignItems && (
        <>
          <TabGuide storageKey="cancelledguides-productos">Guías ya gestionadas con la transportadora — cargá qué productos y cantidades venían en cada una.</TabGuide>
          <CancelledGuideItemAssignmentPanel />
        </>
      )}
      {tab === "reingreso" && canReingreso && (
        <>
          <TabGuide storageKey="cancelledguides-reingreso">Guías con productos ya cargados — reingresa esa mercadería en Just.</TabGuide>
          <CancelledGuideReingresoQueue />
        </>
      )}
      {tab === "historial" && (
        <>
          <TabGuide storageKey="cancelledguides-historial">Registro completo de guías canceladas, con trazabilidad de cada paso.</TabGuide>
          <CancelledGuideHistoryList />
        </>
      )}
    </div>
  );
}
