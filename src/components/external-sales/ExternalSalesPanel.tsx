"use client";

import { useState } from "react";
import { ExternalSaleDeclareForm } from "./ExternalSaleDeclareForm";
import { ExternalSaleReviewInbox } from "./ExternalSaleReviewInbox";
import { ExternalSalePaymentConfirmInbox } from "./ExternalSalePaymentConfirmInbox";
import { ExternalSaleInvoiceInbox } from "./ExternalSaleInvoiceInbox";
import { ExternalSaleDispatchInbox } from "./ExternalSaleDispatchInbox";
import { ExternalSalePrepPanel } from "./ExternalSalePrepPanel";
import { ExternalSalePackAssignInbox } from "./ExternalSalePackAssignInbox";
import { ExternalSalePackDeliveryPanel } from "./ExternalSalePackDeliveryPanel";
import { ExternalSaleClosingInbox } from "./ExternalSaleClosingInbox";
import { ExternalSaleHistoryList } from "./ExternalSaleHistoryList";
import { TabGuide } from "@/components/shared/TabGuide";

type Tab = "declarar" | "revision" | "pagos" | "facturacion" | "agrupar" | "preparar" | "embalaje" | "entregas" | "cierre" | "historial";

export function ExternalSalesPanel({
  canDeclare,
  canReview,
  canConfirmPayment,
  canInvoice,
  canAssignPrep,
  canPrep,
  canAssignPack,
  canPack,
  canClose,
}: {
  canDeclare: boolean;
  canReview: boolean;
  canConfirmPayment: boolean;
  canInvoice: boolean;
  canAssignPrep: boolean;
  canPrep: boolean;
  canAssignPack: boolean;
  canPack: boolean;
  canClose: boolean;
}) {
  const defaultTab: Tab = canDeclare ? "declarar" : canReview ? "revision" : canAssignPrep ? "agrupar" : "historial";
  const [tab, setTab] = useState<Tab>(() => {
    if (typeof window === "undefined") return defaultTab;
    const t = new URLSearchParams(window.location.search).get("etab");
    const valid: Tab[] = ["declarar", "revision", "pagos", "facturacion", "agrupar", "preparar", "embalaje", "entregas", "cierre", "historial"];
    return (valid as string[]).includes(t ?? "") ? (t as Tab) : defaultTab;
  });

  const tabs: { id: Tab; label: string }[] = [
    ...(canDeclare ? [{ id: "declarar" as const, label: "Declarar" }] : []),
    ...(canReview ? [{ id: "revision" as const, label: "Revisión" }] : []),
    ...(canConfirmPayment ? [{ id: "pagos" as const, label: "Pagos" }] : []),
    ...(canInvoice ? [{ id: "facturacion" as const, label: "Facturación" }] : []),
    ...(canAssignPrep ? [{ id: "agrupar" as const, label: "Agrupar" }] : []),
    ...(canPrep ? [{ id: "preparar" as const, label: "Preparar" }] : []),
    ...(canAssignPack ? [{ id: "embalaje" as const, label: "Embalaje" }] : []),
    ...(canPack ? [{ id: "entregas" as const, label: "Mis entregas" }] : []),
    ...(canClose ? [{ id: "cierre" as const, label: "Cierre" }] : []),
    { id: "historial" as const, label: "Historial" },
  ];

  return (
    <div>
      <h1 className="font-display text-[22px] font-bold mb-1">Ventas Externas</h1>
      <p className="text-[13px] text-steel mb-5">Ventas por fuera de Dropi/Rocket — declarar, aprobar, pagar, facturar, agrupar, embalar y entregar, todo en un solo lugar.</p>

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
          <TabGuide storageKey="externalsales-declarar">Declara acá una venta hecha por fuera de Dropi/Rocket: producto, cantidad, precio, y a quién debe entregarle bodega. Bryan la aprueba antes de seguir. Si te la rechaza, corrige lo que te señaló y reenvíala desde esta misma lista.</TabGuide>
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
      {tab === "facturacion" && canInvoice && (
        <>
          <TabGuide storageKey="externalsales-facturacion">En pago anticipado, la factura es obligatoria — recién con ella pasa a Inventario. En contra entrega es opcional, solo si el cliente final la pidió.</TabGuide>
          <ExternalSaleInvoiceInbox />
        </>
      )}
      {tab === "agrupar" && canAssignPrep && (
        <>
          <TabGuide storageKey="externalsales-agrupar">Asigna cada venta lista a un colaborador de tu equipo para que agrupe los productos según la guía.</TabGuide>
          <ExternalSaleDispatchInbox />
        </>
      )}
      {tab === "preparar" && canPrep && (
        <>
          <TabGuide storageKey="externalsales-preparar">Tus ventas asignadas — agrupa los productos, toma fotos según la guía y marca listo para que Fulfilment embale.</TabGuide>
          <ExternalSalePrepPanel />
        </>
      )}
      {tab === "embalaje" && canAssignPack && (
        <>
          <TabGuide storageKey="externalsales-embalaje">Inventario ya dejó listos los productos — asigna a alguien de tu equipo para embalar y entregar. Podés imprimir la guía de salida.</TabGuide>
          <ExternalSalePackAssignInbox />
        </>
      )}
      {tab === "entregas" && canPack && (
        <>
          <TabGuide storageKey="externalsales-entregas">Tus embalajes asignados — entrega al motorizado y tomá la foto en tiempo real de a quién le entregaste.</TabGuide>
          <ExternalSalePackDeliveryPanel />
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
