"use client";

import { useState } from "react";
import { ExternalSaleDeclareForm } from "./ExternalSaleDeclareForm";
import { ExternalSaleReviewInbox } from "./ExternalSaleReviewInbox";
import { ExternalSalePaymentConfirmInbox } from "./ExternalSalePaymentConfirmInbox";
import { ExternalSaleInvoiceInbox } from "./ExternalSaleInvoiceInbox";
import { ExternalSaleDispatchBoard } from "./ExternalSaleDispatchBoard";
import { ExternalSalePrepPanel } from "./ExternalSalePrepPanel";
import { ExternalSalePackDeliveryPanel } from "./ExternalSalePackDeliveryPanel";
import { ExternalSaleClosingInbox } from "./ExternalSaleClosingInbox";
import { ExternalSaleAuditSummary } from "./ExternalSaleAuditSummary";
import { ExternalSaleHistoryList } from "./ExternalSaleHistoryList";
import { ExternalSaleReturnInbox } from "./ExternalSaleReturnInbox";
import { TabGuide } from "@/components/shared/TabGuide";
import { LocalWarrantyPanel } from "./LocalWarrantyPanel";
import { WarrantyPickupInbox } from "./WarrantyPickupInbox";

type Tab = "declarar" | "garantias" | "revision" | "pagos" | "facturacion" | "despacho" | "preparar" | "entregas" | "devoluciones" | "cierre" | "auditoria" | "historial";

export function ExternalSalesPanel({
  canDeclare,
  canReview,
  canConfirmPayment,
  canInvoice,
  canAssignPrep,
  canPrep,
  canAssignPack,
  canPack,
  canReceiveReturn,
  canConfirmReturn,
  canClose,
  isAdmin,
}: {
  canDeclare: boolean;
  canReview: boolean;
  canConfirmPayment: boolean;
  canInvoice: boolean;
  canAssignPrep: boolean;
  canPrep: boolean;
  canAssignPack: boolean;
  canPack: boolean;
  canReceiveReturn: boolean;
  canConfirmReturn: boolean;
  canClose: boolean;
  isAdmin: boolean;
}) {
  // Pedido de Daniel 2026-10-05: Agrupar y Embalaje se juntaron en
  // "Despacho" (cada venta con sus 3 pasos). "Preparar" queda solo para
  // quien agrupa sin ser el líder — el líder lo marca dentro de Despacho.
  const canDispatch = canAssignPrep || canAssignPack;
  const showPrepTab = canPrep && !canAssignPrep;
  const defaultTab: Tab = canDeclare ? "declarar" : canReview ? "revision" : canDispatch ? "despacho" : "historial";
  const [tab, setTab] = useState<Tab>(() => {
    if (typeof window === "undefined") return defaultTab;
    let t = new URLSearchParams(window.location.search).get("etab");
    // Enlaces viejos (avisos ya enviados, Inicio) a las pestañas que se juntaron.
    if (t === "agrupar" || t === "embalaje") t = "despacho";
    if (t === "preparar" && !showPrepTab) t = "despacho";
    const valid: Tab[] = ["declarar", "garantias", "revision", "pagos", "facturacion", "despacho", "preparar", "entregas", "devoluciones", "cierre", "auditoria", "historial"];
    return (valid as string[]).includes(t ?? "") ? (t as Tab) : defaultTab;
  });

  const tabs: { id: Tab; label: string }[] = [
    ...(canDeclare ? [{ id: "declarar" as const, label: "Declarar" }] : []),
    ...(canDeclare ? [{ id: "garantias" as const, label: "Garantías" }] : []),
    ...(canReview ? [{ id: "revision" as const, label: "Revisión" }] : []),
    ...(canConfirmPayment ? [{ id: "pagos" as const, label: "Pagos" }] : []),
    ...(canInvoice ? [{ id: "facturacion" as const, label: "Facturación" }] : []),
    ...(canDispatch ? [{ id: "despacho" as const, label: "Despacho" }] : []),
    ...(showPrepTab ? [{ id: "preparar" as const, label: "Preparar" }] : []),
    ...(canPack ? [{ id: "entregas" as const, label: "Mis entregas" }] : []),
    ...(canReceiveReturn || canConfirmReturn ? [{ id: "devoluciones" as const, label: "Devoluciones" }] : []),
    ...(canClose ? [{ id: "cierre" as const, label: "Cierre" }] : []),
    ...(canClose ? [{ id: "auditoria" as const, label: "Auditoría" }] : []),
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
      {tab === "garantias" && canDeclare && (
        <>
          <TabGuide storageKey="externalsales-garantias">Garantías en Guayaquil con nuestro motorizado. Escribe la guía que salió (o la venta VE): DAFLOW copia el cliente, la dirección y los productos. Tú eliges qué falta entregar, el motivo, el cobro y el motorizado. Sigue el mismo camino que una venta externa (agrupar, embalar, motorizado) y el flete se paga por Caja Chica.</TabGuide>
          <LocalWarrantyPanel />
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
          <TabGuide storageKey="externalsales-facturacion">La factura es obligatoria salvo que el asesor haya marcado que el cliente no la pidió (con o sin recaudo). Ya no bloquea el despacho, solo el cierre de Nairoby.</TabGuide>
          <ExternalSaleInvoiceInbox />
        </>
      )}
      {tab === "despacho" && canDispatch && (
        <>
          <TabGuide storageKey="externalsales-despacho">Cada venta aprobada sale una sola vez con sus 3 pasos: quién agrupa, la foto de que ya está agrupada y quién embala y entrega. Puedes asignar a las dos personas desde el principio; a quien embala le llega el aviso cuando ya esté agrupado. Si alguien no avanza, reasígnala a otra persona.</TabGuide>
          <ExternalSaleDispatchBoard canAssignGroup={canAssignPrep} canAssignPack={canAssignPack} />
        </>
      )}
      {tab === "preparar" && showPrepTab && (
        <>
          <TabGuide storageKey="externalsales-preparar">Tus ventas asignadas — agrupa los productos, toma fotos según la guía y marca listo para que siga a embalaje y entrega.</TabGuide>
          <ExternalSalePrepPanel />
        </>
      )}
      {tab === "entregas" && canPack && (
        <>
          <TabGuide storageKey="externalsales-entregas">Tus embalajes asignados — entrega al motorizado y tomá la foto en tiempo real de a quién le entregaste.</TabGuide>
          <ExternalSalePackDeliveryPanel />
        </>
      )}
      {tab === "devoluciones" && (canReceiveReturn || canConfirmReturn) && (
        <>
          <TabGuide storageKey="externalsales-devoluciones">Ventas que el asesor reportó como devueltas por el cliente. Inventario confirma que llegó físicamente y completo; recién con la aprobación de Daniel se suma de nuevo a INVESTOCK.</TabGuide>
          {canReceiveReturn && <WarrantyPickupInbox />}
          <ExternalSaleReturnInbox canReceive={canReceiveReturn} canConfirm={canConfirmReturn} />
        </>
      )}
      {tab === "cierre" && canClose && (
        <>
          <TabGuide storageKey="externalsales-cierre">Ventas con pago confirmado y ya entregadas — cierra cada una para dejar el registro completo.</TabGuide>
          <ExternalSaleClosingInbox />
        </>
      )}
      {tab === "auditoria" && canClose && (
        <>
          <TabGuide storageKey="externalsales-auditoria">Ventas ya cerradas, acumuladas para revisar el proceso completo más adelante — B2B y B2C juntas, solo lectura.</TabGuide>
          <ExternalSaleAuditSummary />
        </>
      )}
      {tab === "historial" && (
        <>
          <TabGuide storageKey="externalsales-historial">Registro completo de ventas externas, con trazabilidad de cada paso.</TabGuide>
          <ExternalSaleHistoryList
            canDelete={isAdmin}
            canPrintGuide={canAssignPack}
            hideMoney={!(isAdmin || canDeclare || canReview || canConfirmPayment || canInvoice || canClose || canAssignPrep)}
          />
        </>
      )}
    </div>
  );
}
