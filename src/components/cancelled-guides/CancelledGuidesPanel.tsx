"use client";

import { useState } from "react";
import { CancelledGuideSubmitForm } from "./CancelledGuideSubmitForm";
import { CancelledGuideConfirmationsInbox } from "./CancelledGuideConfirmationsInbox";
import { CancelledGuideCutoffInbox } from "./CancelledGuideCutoffInbox";
import { CancelledGuideReingresoQueue } from "./CancelledGuideReingresoQueue";
import { CancelledGuideHistoryList } from "./CancelledGuideHistoryList";
import { TabGuide } from "@/components/shared/TabGuide";

type Tab = "reportar" | "confirmaciones" | "corte" | "reingreso" | "historial";

export function CancelledGuidesPanel({
  canSubmit,
  canConfirm,
  canCutoff,
  canReingreso,
}: {
  canSubmit: boolean;
  canConfirm: boolean;
  canCutoff: boolean;
  canReingreso: boolean;
}) {
  const defaultTab: Tab = canSubmit ? "reportar" : canConfirm ? "confirmaciones" : canCutoff ? "corte" : canReingreso ? "reingreso" : "historial";
  const [tab, setTab] = useState<Tab>(defaultTab);

  const tabs: { id: Tab; label: string }[] = [
    ...(canSubmit ? [{ id: "reportar" as const, label: "Reportar" }] : []),
    ...(canConfirm ? [{ id: "confirmaciones" as const, label: "Confirmaciones" }] : []),
    ...(canCutoff ? [{ id: "corte" as const, label: "Corte semanal" }] : []),
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
          <TabGuide storageKey="cancelledguides-reportar">Reporta acá una guía que hay que cancelar — Fulfillment e Inventario se enteran al toque para no despacharla.</TabGuide>
          <CancelledGuideSubmitForm />
        </>
      )}
      {tab === "confirmaciones" && canConfirm && (
        <>
          <TabGuide storageKey="cancelledguides-confirmaciones">Confirma acá que hiciste tu gestión (no despachar) para cada guía reportada — sin importar quién la haya subido.</TabGuide>
          <CancelledGuideConfirmationsInbox />
        </>
      )}
      {tab === "corte" && canCutoff && (
        <>
          <TabGuide storageKey="cancelledguides-corte">Decide, guía por guía, si realmente no se despachó (pasa a la cola de Daniel para reingresar a Just) o si se despachó igual por otro motivo.</TabGuide>
          <CancelledGuideCutoffInbox />
        </>
      )}
      {tab === "reingreso" && canReingreso && (
        <>
          <TabGuide storageKey="cancelledguides-reingreso">Guías confirmadas como realmente canceladas — reingresa esa mercadería en Just.</TabGuide>
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
