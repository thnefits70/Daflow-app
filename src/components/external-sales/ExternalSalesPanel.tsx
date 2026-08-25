"use client";

import { useState } from "react";
import { ExternalSaleDeclareForm } from "./ExternalSaleDeclareForm";
import { ExternalSaleReviewInbox } from "./ExternalSaleReviewInbox";
import { ExternalSalePaymentConfirmInbox } from "./ExternalSalePaymentConfirmInbox";
import { ExternalSaleDispatchInbox } from "./ExternalSaleDispatchInbox";
import { ExternalSaleDeliveryPanel } from "./ExternalSaleDeliveryPanel";
import { ExternalSaleClosingInbox } from "./ExternalSaleClosingInbox";
import { ExternalSaleHistoryList } from "./ExternalSaleHistoryList";
import { TabGuide } from "@/components/shared/TabGuide";

type Tab = "declarar" | "revision" | "pagos" | "despacho" | "entregas" | "cierre" | "historial";

export function ExternalSalesPanel({
  canDeclare,
  canReview,
  canConfirmPayment,
  canAssignDispatch,
  canDeliver,
  canClose,
}: {
  canDeclare: boolean;
  canReview: boolean;
  canConfirmPayment: boolean;
  canAssignDispatch: boolean;
  canDeliver: boolean;
  canClose: boolean;
}) {
  const defaultTab: Tab = canDeclare ? "declarar" : canReview ? "revision" : canAssignDispatch ? "despacho" : "historial";
  const [tab, setTab] = useState<Tab>(() => {
    if (typeof window === "undefined") return defaultTab;
    const t = new URLSearchParams(window.location.search).get("etab");
    const valid: Tab[] = ["declarar", "revision", "pagos", "despacho", "entregas", "cierre", "historial"];
    return (valid as string[]).includes(t ?? "") ? (t as Tab) : defaultTab;
  });

  const tabs: { id: Tab; label: string }[] = [
    ...(canDeclare ? [{ id: "declarar" as const, label: "Declarar" }] : []),
    ...(canReview ? [{ id: "revision" as const, label: "Revisión" }] : []),
    ...(canConfirmPayment ? [{ id: "pagos" as const, label: "Pagos" }] : []),
    ...(canAssignDispatch ? [{ id: "despacho" as const, label: "Despacho" }] : []),
    ...(canDeliver ? [{ id: "entregas" as const, label: "Mis entregas" }] : []),
    ...(canClose ? [{ id: "cierre" as const, label: "Cierre" }] : []),
    { id: "historial" as const, label: "Historial" },
  ];

  return (
    <div>
      <h1 className="font-display text-[22px] font-bold mb-1">Ventas Externas</h1>
      <p className="text-[13px] text-steel mb-5">Ventas por fuera de Dropi/Rocket — declarar, aprobar, pagar, despachar y cerrar, todo en un solo lugar.</p>

      <div className="flex gap-6 border-b border-rule mb-5 flex-wrap">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`pb-2.5 text-[13.5px] font-semibold cursor-pointer border-b-2 ${tab === t.id ? "border-teal text-ink" : "border-transparent text-steel hover:text-ink"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "declarar" && canDeclare && (
        <>
          <TabGuide storageKey="externalsales-declarar">Declara acá una venta hecha por fuera de Dropi/Rocket: producto, cantidad, precio, y a quién debe entregarle bodega. Bryan la aprueba antes de seguir.</TabGuide>
          <ExternalSaleDeclareForm />
        </>
      )}
      {tab === "revision" && canReview && (
        <>
          <TabGuide storageKey="externalsales-revision">Aprueba o rechaza las ventas declaradas — un rechazo siempre necesita una justificación.</TabGuide>
          <ExternalSaleReviewInbox />
        </>
      )}
      {tab === "pagos" && canConfirmPayment && (
        <>
          <TabGuide storageKey="externalsales-pagos">Confirma acá que de verdad recibiste el dinero de cada venta, después de revisar el comprobante.</TabGuide>
          <ExternalSalePaymentConfirmInbox />
        </>
      )}
      {tab === "despacho" && canAssignDispatch && (
        <>
          <TabGuide storageKey="externalsales-despacho">Asigna cada venta aprobada a un colaborador de tu equipo para que la despache — no hace falta esperar a que se confirme el pago.</TabGuide>
          <ExternalSaleDispatchInbox />
        </>
      )}
      {tab === "entregas" && canDeliver && (
        <>
          <TabGuide storageKey="externalsales-entregas">Tus despachos asignados — entrega el producto y sube una foto para cerrar tu parte.</TabGuide>
          <ExternalSaleDeliveryPanel />
        </>
      )}
      {tab === "cierre" && canClose && (
        <>
          <TabGuide storageKey="externalsales-cierre">Ventas con pago confirmado y ya entregadas — cierra cada una para dejar el registro completo.</TabGuide>
          <ExternalSaleClosingInbox />
        </>
      )}
      {tab === "historial" && (
        <>
          <TabGuide storageKey="externalsales-historial">Registro completo de ventas externas, con trazabilidad de cada paso.</TabGuide>
          <ExternalSaleHistoryList />
        </>
      )}
    </div>
  );
}
