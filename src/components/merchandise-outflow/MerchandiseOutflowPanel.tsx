"use client";

import { useState } from "react";
import { DocumentCaptureFlow } from "./DocumentCaptureFlow";
import { DeteriorCapture } from "./DeteriorCapture";
import { DeteriorResolutionInbox } from "./DeteriorResolutionInbox";
import { SupplierExchangeCapture } from "./SupplierExchangeCapture";
import { SupplierExchangeResolutionInbox } from "./SupplierExchangeResolutionInbox";
import { WriteOffQueue } from "./WriteOffQueue";
import { HistoryList } from "./HistoryList";
import { CancelledGuidesPanel } from "@/components/cancelled-guides/CancelledGuidesPanel";
import { TabGuide } from "@/components/shared/TabGuide";

type Tab = "despacho" | "garantia" | "deterioro" | "proveedor" | "guias" | "baja" | "historial";

export function MerchandiseOutflowPanel({
  canCapture,
  canAct = false,
  canView = false,
  canViewSupplierExchangeResolution = false,
  canSubmitCancelledGuide = false,
  canConfirmCancelledGuide = false,
  canCutoffCancelledGuide = false,
}: {
  canCapture: boolean;
  canAct?: boolean;
  // Fix confirmado 2026-08-26 (reportado por el usuario: "se le cae" a
  // Bryan) — "Dar de baja en Just" e "Historial" son de TODOS los motivos
  // de Egresos, no solo de lo que Bryan puede ver por su acceso a Guías
  // Canceladas. Antes se mostraban sin este gate, y como sus endpoints SÍ
  // exigen canViewMerchandiseOutflow (equipo de Inventario o admin), a
  // Bryan el fetch le devolvía 403 y el componente crasheaba tratando de
  // hacer `.map()` sobre `{error: "No autorizado."}`. Ahora esas dos
  // pestañas dependen de este prop, y además WriteOffQueue/HistoryList ya
  // no crashean ante una respuesta que no sea un arreglo.
  canView?: boolean;
  // Confirmado 2026-08-26: pedido explícito del usuario — quien resuelve
  // cada producto de "Cambio con proveedor" (cambio o crédito) ya NO es
  // Daniel, es quien solicitó esa compra originalmente (o Bryan si el
  // producto no tiene compra vinculada) — ver /area/cambio-proveedor-gestiones.
  // Daniel y admin quedan en modo LECTURA acá — antes ni siquiera admin veía
  // esta pestaña (canAct es exclusivo de Daniel, "ni siquiera admin"), así
  // que esto amplía visibilidad de solo lectura sin tocar quién actúa.
  canViewSupplierExchangeResolution?: boolean;
  // Guías Canceladas (Fase 4) — vive como pestaña acá adentro (pedido
  // explícito del usuario), aunque su resultado final sea una entrada, no
  // una salida. Reingresar reusa `canAct` (Daniel exclusivo, ya pasado).
  canSubmitCancelledGuide?: boolean;
  canConfirmCancelledGuide?: boolean;
  canCutoffCancelledGuide?: boolean;
}) {
  const defaultTab: Tab = canCapture
    ? "despacho"
    : canAct
      ? "baja"
      : canSubmitCancelledGuide || canConfirmCancelledGuide || canCutoffCancelledGuide
        ? "guias"
        : "historial";
  // Confirmado 2026-08-25: pedido explícito del usuario — todos los
  // motivos de egreso viven en una sola sesión para que Daniel no salte
  // entre módulos. Los atajos de Inicio/notificaciones llegan con
  // ?tab=egresos&otab=X para entrar directo a lo que hay que gestionar —
  // resuelto en el inicializador de useState (no en un efecto) para no
  // disparar un setState extra apenas monta.
  const [tab, setTab] = useState<Tab>(() => {
    if (typeof window === "undefined") return defaultTab;
    const t = new URLSearchParams(window.location.search).get("otab");
    if (t === "baja" || t === "deterioro" || t === "proveedor" || t === "guias") return t;
    return defaultTab;
  });

  // Fix confirmado 2026-08-26: SupplierExchangeResolutionInbox solo cargaba
  // una vez al montar, así que una solicitud recién enviada no aparecía en
  // "Pendientes de resolución" hasta refrescar la página a mano. El `key`
  // fuerza que se remonte (y vuelva a pedir la lista) cada vez que se envía
  // una solicitud nueva.
  const [proveedorRefreshKey, setProveedorRefreshKey] = useState(0);

  const canSeeProveedorTab = canAct || canViewSupplierExchangeResolution;

  const tabs: { id: Tab; label: string }[] = [
    ...(canCapture ? [{ id: "despacho" as const, label: "Despacho" }] : []),
    ...(canCapture ? [{ id: "garantia" as const, label: "Garantía" }] : []),
    ...(canCapture ? [{ id: "deterioro" as const, label: "Deterioro" }] : []),
    ...(canSeeProveedorTab ? [{ id: "proveedor" as const, label: "Cambio con proveedor" }] : []),
    ...(canSubmitCancelledGuide || canConfirmCancelledGuide || canCutoffCancelledGuide || canAct ? [{ id: "guias" as const, label: "Guías canceladas" }] : []),
    ...(canView ? [{ id: "baja" as const, label: "Dar de baja en Just" }, { id: "historial" as const, label: "Historial" }] : []),
  ];

  return (
    <div>
      <h1 className="font-display text-[22px] font-bold mb-1">Registro de Egresos</h1>
      <p className="text-[13px] text-steel mb-5">Mercadería que sale del inventario físico por vías que Just no registra solo.</p>

      <div className="flex gap-6 border-b border-rule mb-5">
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

      {tab === "despacho" && canCapture && (
        <>
          <TabGuide storageKey="merchoutflow-despacho">
            Fotografía la hoja física de despacho — la IA lee cada renglón (producto + cantidad) y arma un consolidado editable. Confirma cada fila contra el catálogo antes de enviar el lote.
          </TabGuide>
          <DocumentCaptureFlow reason="DESPACHO" />
        </>
      )}
      {tab === "garantia" && canCapture && (
        <>
          <TabGuide storageKey="merchoutflow-garantia">
            Fotografía el manifiesto de garantía que genera Fulfillment — mismo mecanismo que despacho, la IA arma el consolidado y confirmas cada renglón.
          </TabGuide>
          <DocumentCaptureFlow reason="GARANTIA" />
        </>
      )}
      {tab === "deterioro" && canCapture && (
        <>
          <TabGuide storageKey="merchoutflow-deterioro">
            {canAct
              ? "Reporta acá un producto encontrado dañado en bodega (no una devolución). Abajo ves los reportes pendientes de tu resolución: solucionado ahí mismo (no deja rastro), dar de baja, o escalar a Compras si es mercadería recién llegada."
              : "Reporta acá un producto encontrado dañado en bodega (no una devolución). Daniel decide qué hacer con cada reporte."}
          </TabGuide>
          <div className="flex flex-col gap-6">
            <DeteriorCapture />
            <div>
              <div className="font-display font-bold text-[14px] mb-2.5">Pendientes de resolución</div>
              <DeteriorResolutionInbox canAct={canAct} />
            </div>
          </div>
        </>
      )}
      {tab === "proveedor" && canSeeProveedorTab && (
        <>
          <TabGuide storageKey="merchoutflow-proveedor">
            {canAct ? (
              <>Elige el proveedor y agrega todos los productos que le vas a devolver en un mismo paquete — cada uno se cruza solo contra la última compra a ese proveedor para estimar el crédito reclamable. Toma foto de la lista física como evidencia y deja lista la solicitud: sale de Just en ese momento (cae directo en la cola de baja) y te da un código para imprimir la guía y pegarla en el paquete. Quien resuelve cada producto (cambio o crédito) es quien solicitó esa compra originalmente, no tú — abajo ves el estado en modo lectura.</>
            ) : (
              <>Vista de solo lectura de las solicitudes de cambio con proveedor que arma Daniel. Cada producto lo resuelve (cambio o crédito) quien solicitó esa compra originalmente, no Daniel — esa persona gestiona desde su propia pantalla de pendientes.</>
            )}
          </TabGuide>
          <div className="flex flex-col gap-6">
            {canAct && <SupplierExchangeCapture onSent={() => setProveedorRefreshKey((k) => k + 1)} />}
            <div>
              <div className="font-display font-bold text-[14px] mb-2.5">Estado de resolución</div>
              <SupplierExchangeResolutionInbox key={proveedorRefreshKey} />
            </div>
          </div>
        </>
      )}
      {tab === "guias" && (canSubmitCancelledGuide || canConfirmCancelledGuide || canCutoffCancelledGuide || canAct) && (
        <>
          <TabGuide storageKey="merchoutflow-guias">
            Aunque el resultado final sea reingresar mercadería a Just (no darla de baja), las guías canceladas viven acá junto a los demás motivos para no saltar entre módulos.
          </TabGuide>
          <CancelledGuidesPanel canSubmit={canSubmitCancelledGuide} canConfirm={canConfirmCancelledGuide} canCutoff={canCutoffCancelledGuide} canReingreso={canAct} />
        </>
      )}
      {tab === "baja" && canView && (
        <>
          <TabGuide storageKey="merchoutflow-baja">
            {canAct
              ? "Acá cae TODO lo que está listo para dar de baja en Just, sin importar el motivo — despacho, garantía, deterioro dado de baja, y compras personales (enganche automático). Confirma solo cuando ya lo hayas hecho de verdad en Just."
              : "Vista de solo lectura de lo pendiente de dar de baja en Just. Confirmar es exclusivo de Daniel."}
          </TabGuide>
          <WriteOffQueue canAct={canAct} />
        </>
      )}
      {tab === "historial" && canView && (
        <>
          <TabGuide storageKey="merchoutflow-historial">Consulta acá el registro completo de egresos, con trazabilidad de quién capturó y quién dio de baja.</TabGuide>
          <HistoryList />
        </>
      )}
    </div>
  );
}
