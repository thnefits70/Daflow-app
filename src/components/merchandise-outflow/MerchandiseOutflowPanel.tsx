"use client";

import { useState } from "react";
import { DeteriorCapture } from "./DeteriorCapture";
import { DeteriorResolutionInbox } from "./DeteriorResolutionInbox";
import { DeteriorTraceList } from "./DeteriorTraceList";
import { SupplierExchangeCapture } from "./SupplierExchangeCapture";
import { SupplierExchangeResolutionInbox } from "./SupplierExchangeResolutionInbox";
import { SupplierExchangeMyResolutions } from "./SupplierExchangeMyResolutions";
import { HistoryList } from "./HistoryList";
import { CancelledGuidesPanel } from "@/components/cancelled-guides/CancelledGuidesPanel";
import { FulfillmentRequestPanel } from "./FulfillmentRequestPanel";
import { TabGuide } from "@/components/shared/TabGuide";

type Tab = "deterioro" | "seguimiento" | "proveedor" | "guias" | "solicitud" | "historial";

export function MerchandiseOutflowPanel({
  canCapture,
  canAct = false,
  canView = false,
  canViewSupplierExchangeResolution = false,
  supplierExchangeMineCount = 0,
  canConfirmFinanceWriteOff = false,
  financeWriteOffPendingCount = 0,
  canSubmitCancelledGuide = false,
  canManageCancelledGuideBatches = false,
  canConfirmCancelledGuideFulfillmentRemoval = false,
  canAssignCancelledGuideItems = false,
  canSubmitFulfillmentRequest = false,
  canViewFulfillmentRequests = false,
  isAdmin = false,
  viewerDeptCode = null,
}: {
  canCapture: boolean;
  canAct?: boolean;
  // Fix confirmado 2026-08-26 (reportado por el usuario: "se le cae" a
  // Bryan) — "Historial" es de TODOS los motivos
  // de Egresos, no solo de lo que Bryan puede ver por su acceso a Guías
  // Canceladas. Antes se mostraban sin este gate, y como sus endpoints SÍ
  // exigen canViewMerchandiseOutflow (equipo de Inventario o admin), a
  // Bryan el fetch le devolvía 403 y el componente crasheaba tratando de
  // hacer `.map()` sobre `{error: "No autorizado."}`. Ahora esa pestaña
  // depende de este prop, y además HistoryList ya no crashea ante una
  // respuesta que no sea un arreglo.
  canView?: boolean;
  // Ya no se usa desde que se quitó la foto del manifiesto (2026-09-23) —
  // se deja en el tipo para no romper a quien todavía lo pasa.
  canManageJustCatalog?: boolean;
  // Confirmado 2026-08-26: pedido explícito del usuario — quien resuelve
  // cada producto de "Cambio con proveedor" (cambio o crédito) ya NO es
  // Daniel, es quien solicitó esa compra originalmente (o Bryan si el
  // producto no tiene compra vinculada) — ver /area/cambio-proveedor-gestiones.
  // Daniel y admin quedan en modo LECTURA acá — antes ni siquiera admin veía
  // esta pestaña (canAct es exclusivo de Daniel, "ni siquiera admin"), así
  // que esto amplía visibilidad de solo lectura sin tocar quién actúa.
  canViewSupplierExchangeResolution?: boolean;
  // Confirmado 2026-08-27, pedido explícito del usuario: cuántos productos
  // de este tab tiene ESTE usuario pendientes de gestionar como quien pidió
  // la compra original (o Bryan de respaldo) — antes esto solo vivía en la
  // página standalone /area/cambio-proveedor-gestiones; ahora se ve también
  // acá, en "Mi área de trabajo", que es donde el usuario espera encontrarlo.
  supplierExchangeMineCount?: number;
  // Confirmado 2026-08-27, pedido explícito del usuario: cuando un ítem de
  // "Cambio con proveedor" queda RECHAZADO (el proveedor no cambia ni da
  // crédito), Nairoby (Finanzas) confirma que ya dio de baja esa mercadería
  // en la parte financiera — Daniel hace lo mismo pero en Just, reusando
  // `canAct` (ya exclusivo de él). canConfirmFinanceWriteOff es el permiso;
  // financeWriteOffPendingCount es cuántos tiene ella pendientes de
  // confirmar ahora mismo — amplía la visibilidad de la pestaña igual que
  // supplierExchangeMineCount, aunque no tenga ningún otro acceso al módulo.
  canConfirmFinanceWriteOff?: boolean;
  financeWriteOffPendingCount?: number;
  // Guías Canceladas (Fase 4) — vive como pestaña acá adentro (pedido
  // explícito del usuario), aunque su resultado final sea una entrada, no
  // una salida. Reingresar reusa `canAct` (Daniel exclusivo, ya pasado).
  // Rediseñado 2026-09-02: canConfirmCancelledGuide/canCutoffCancelledGuide
  // quedaron reemplazados por canManageCancelledGuideBatches (Bryan
  // gestiona el lote con la transportadora/Dropi) y
  // canAssignCancelledGuideItems (Heidy carga productos por guía).
  // Agregado 2026-09-03, pedido explícito del usuario: Yair (líder FUL)
  // confirma, entre Bryan y Daniel, que sacó las guías gestionadas del área
  // de Fulfillment (canConfirmCancelledGuideFulfillmentRemoval).
  canSubmitCancelledGuide?: boolean;
  canManageCancelledGuideBatches?: boolean;
  canConfirmCancelledGuideFulfillmentRemoval?: boolean;
  canAssignCancelledGuideItems?: boolean;
  // Confirmado 2026-09-21: Solicitud de Fulfillment (Yair sube el Excel de
  // Rocket, compendiado por producto real con combos ya expandidos por
  // receta) — canSubmit captura (equipo FUL), canView es lectura para
  // Daniel/admin.
  canSubmitFulfillmentRequest?: boolean;
  canViewFulfillmentRequests?: boolean;
  // Confirmado 2026-08-28, pedido explícito del usuario: el admin puede
  // revisar/comentar (opcional) un rechazo total del proveedor — puro
  // historial, no gatea a Nairoby ni a Daniel. Ver canReviewAsAdmin en
  // SupplierExchangeResolutionInbox.
  isAdmin?: boolean;
  // Confirmado 2026-09-03, pedido explícito del usuario: quien reporta desde
  // Fulfillment (hoy Yair) solo necesita ver Provedix/Damián en "Reportar" —
  // ver allowedSourceAreasFor en cancelledGuidesLabels.ts.
  viewerDeptCode?: string | null;
}) {
  // Confirmado 2026-08-27, pedido explícito del usuario: "Cambio con
  // proveedor" gana sobre "Guías canceladas" como pestaña por defecto en
  // cuanto alguien (ej. Bryan) tiene algo propio pendiente de gestionar ahí
  // — antes "guias" siempre ganaba primero para cualquiera de MKT/FUL, así
  // que un pendiente urgente de proveedor quedaba escondido detrás.
  // Confirmado 2026-09-23 (plan de cortes acordado con el usuario): los
  // despachos y garantías ya no se fotografían — llegan como cortes desde
  // Fulfillment (pestaña "Solicitud Fulfillment"), que pasa a ser la
  // pestaña principal para Inventario y Fulfillment.
  const defaultTab: Tab = canSubmitFulfillmentRequest || canViewFulfillmentRequests
    ? "solicitud"
    : canCapture
      ? "deterioro"
      : canAct
        ? "historial"
        : supplierExchangeMineCount > 0 || financeWriteOffPendingCount > 0 || canConfirmFinanceWriteOff
          ? "proveedor"
          : canSubmitCancelledGuide || canManageCancelledGuideBatches || canConfirmCancelledGuideFulfillmentRemoval || canAssignCancelledGuideItems
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
    if (t === "deterioro" || t === "seguimiento" || t === "proveedor" || t === "guias") return t;
    // Avisos de cortes (Yair envió / faltaron productos) llegan con otab=solicitud.
    if (t === "solicitud" && (canSubmitFulfillmentRequest || canViewFulfillmentRequests)) return t;
    return defaultTab;
  });

  // Fix confirmado 2026-08-26: SupplierExchangeResolutionInbox solo cargaba
  // una vez al montar, así que una solicitud recién enviada no aparecía en
  // "Pendientes de resolución" hasta refrescar la página a mano. El `key`
  // fuerza que se remonte (y vuelva a pedir la lista) cada vez que se envía
  // una solicitud nueva.
  const [proveedorRefreshKey, setProveedorRefreshKey] = useState(0);
  const [deteriorRefreshKey, setDeteriorRefreshKey] = useState(0);

  // Confirmado 2026-09-24, pedido de Nairoby: ella recibe avisos cuando un
  // reclamo al proveedor se traba — necesita ver Seguimiento y esta pestaña
  // siempre (solo lectura), no solo cuando tiene una baja financiera.
  const canSeeProveedorTab = canAct || canViewSupplierExchangeResolution || supplierExchangeMineCount > 0 || financeWriteOffPendingCount > 0 || canConfirmFinanceWriteOff;
  const canSeeSeguimientoTab = canCapture || canView || canConfirmFinanceWriteOff;

  const tabs: { id: Tab; label: string }[] = [
    // Confirmado 2026-09-23: se quitaron las pestañas "Despacho" y
    // "Garantía" (foto del manifiesto + IA) — pedido explícito del usuario,
    // sin camino alterno. Ahora todo despacho y garantía llega como corte
    // en "Solicitud Fulfillment", primera pestaña.
    ...(canSubmitFulfillmentRequest || canViewFulfillmentRequests ? [{ id: "solicitud" as const, label: "Solicitud Fulfillment" }] : []),
    ...(canCapture ? [{ id: "deterioro" as const, label: "Deterioro" }] : []),
    // Confirmado 2026-09-23, pedido de Daniel: seguimiento de cada deterioro
    // de principio a fin (su decisión → gestión de Jariel → respuesta del
    // proveedor), justo entre Deterioro y Cambio con proveedor.
    ...(canSeeSeguimientoTab ? [{ id: "seguimiento" as const, label: "Seguimiento de deterioro" }] : []),
    ...(canSeeProveedorTab ? [{ id: "proveedor" as const, label: "Mercadería devuelta al proveedor" }] : []),
    ...(canSubmitCancelledGuide || canManageCancelledGuideBatches || canConfirmCancelledGuideFulfillmentRemoval || canAssignCancelledGuideItems || canAct ? [{ id: "guias" as const, label: "Guías canceladas" }] : []),
    // Confirmado 2026-09-23: ya no existe "Dar de baja en Just" — cada
    // salida se descuenta sola de INVESTOCK en el momento en que se envía.
    ...(canView ? [{ id: "historial" as const, label: "Historial" }] : []),
  ];

  return (
    <div>
      <h1 className="font-display text-[22px] font-bold mb-1">Registro de Egresos</h1>
      <p className="text-[13px] text-steel mb-5">Toda la mercadería que sale de bodega, sin importar el motivo — cada salida se descuenta sola de INVESTOCK.</p>

      <div className="flex gap-6 border-b border-rule mb-5">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`pb-2.5 text-[13.5px] font-semibold cursor-pointer border-b-2 flex items-center gap-1.5 ${tab === t.id ? "border-teal text-ink" : "border-transparent text-steel hover:text-ink"}`}
          >
            {t.label}
            {t.id === "proveedor" && supplierExchangeMineCount + financeWriteOffPendingCount > 0 && (
              <span className="font-mono text-[10px] font-semibold bg-red/20 text-red rounded-full px-1.5 py-0.5">
                {supplierExchangeMineCount + financeWriteOffPendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "deterioro" && canCapture && (
        <>
          <TabGuide storageKey="merchoutflow-deterioro">
            {canAct
              ? "Elige el proveedor y agrega uno o varios productos encontrados dañados en bodega (no una devolución) con una sola foto compartida. Abajo ves los reportes pendientes de tu resolución: solucionado ahí mismo (no deja rastro), dar de baja, o escalar a Compras si es mercadería recién llegada."
              : "Elige el proveedor y agrega uno o varios productos encontrados dañados en bodega (no una devolución) con una sola foto compartida. Daniel decide qué hacer con cada producto reportado."}
          </TabGuide>
          <div className="flex flex-col gap-6">
            <DeteriorCapture allowUpload={canAct} onReported={() => setDeteriorRefreshKey((k) => k + 1)} />
            <div>
              <div className="font-display font-bold text-[14px] mb-2.5">Pendientes de resolución</div>
              <DeteriorResolutionInbox key={deteriorRefreshKey} canAct={canAct} />
            </div>
          </div>
        </>
      )}
      {tab === "seguimiento" && canSeeSeguimientoTab && (
        <>
          <TabGuide storageKey="merchoutflow-seguimiento">
            Todo lo que se reportó como deterioro y en qué va cada producto: la decisión de Daniel y, si se escaló a Compras, qué proveedor confirmó Jariel y qué respondió el proveedor (cambio, crédito o rechazo). Solo lectura — toca un producto para ver su recorrido completo. Si el proveedor aceptó (cambio o saldo a favor), toca &quot;Armar paquete de devolución&quot; y el producto pasa solo a &quot;Mercadería devuelta al proveedor&quot; — ahí solo tomas la foto de la lista y lo dejas listo.
          </TabGuide>
          <DeteriorTraceList canAct={canAct} onGoToExchange={() => setTab("proveedor")} />
        </>
      )}
      {tab === "proveedor" && canSeeProveedorTab && (
        <>
          <TabGuide storageKey="merchoutflow-proveedor">
            {canAct ? (
              <>Elige el proveedor y agrega todos los productos que le vas a devolver en un mismo paquete — cada uno se cruza solo contra la última compra a ese proveedor para estimar el crédito reclamable. Toma foto de la lista física como evidencia y deja lista la solicitud: se descuenta de INVESTOCK en ese momento y te da un código para imprimir la guía y pegarla en el paquete. Quien resuelve cada producto (cambio o crédito) es quien solicitó esa compra originalmente, no tú — abajo ves el estado en modo lectura.</>
            ) : canViewSupplierExchangeResolution ? (
              <>Vista de solo lectura de la mercadería que Daniel le devuelve al proveedor. Cada producto lo resuelve (cambio o crédito o rechazo) quien solicitó esa compra originalmente, no Daniel — esa persona gestiona desde acá abajo, en su propia sección.</>
            ) : canConfirmFinanceWriteOff ? (
              <>Acá abajo ves todo lo que se devolvió a un proveedor y en qué va. Un cambio queda abierto hasta que Daniel confirma con foto que llegó el reemplazo en buen estado. Si el proveedor rechazó (ni cambia ni da crédito), te toca registrar la pérdida en la parte financiera.</>
            ) : (
              <>Acá abajo están los productos que Inventario está devolviendo a un proveedor y que te toca gestionar a ti (porque pediste originalmente esa compra, o no tenía compra vinculada). Contacta al proveedor y registra si aceptó cambiarlo, dio crédito, o rechazó todo.</>
            )}
          </TabGuide>
          <div className="flex flex-col gap-6">
            {canAct && <SupplierExchangeCapture onSent={() => setProveedorRefreshKey((k) => k + 1)} />}
            <div>
              <div className="font-display font-bold text-[14px] mb-2.5">Mis solicitudes de gestión pendiente</div>
              <SupplierExchangeMyResolutions />
            </div>
            {(canViewSupplierExchangeResolution || canConfirmFinanceWriteOff) && (
              <div>
                <div className="font-display font-bold text-[14px] mb-2.5">Estado de resolución</div>
                <SupplierExchangeResolutionInbox key={proveedorRefreshKey} canConfirmFinanceWriteOff={canConfirmFinanceWriteOff} canReviewAsAdmin={isAdmin} canConfirmReplacementArrival={canAct} />
              </div>
            )}
          </div>
        </>
      )}
      {tab === "guias" && (canSubmitCancelledGuide || canManageCancelledGuideBatches || canConfirmCancelledGuideFulfillmentRemoval || canAssignCancelledGuideItems || canAct) && (
        <>
          <TabGuide storageKey="merchoutflow-guias">
            Aunque el resultado final sea que la mercadería vuelve al inventario (no se da de baja), las guías canceladas viven acá junto a los demás motivos para no saltar entre módulos. Cuando los tres pasos están listos, vuelve sola a INVESTOCK.
          </TabGuide>
          <CancelledGuidesPanel canSubmit={canSubmitCancelledGuide} canManageBatches={canManageCancelledGuideBatches} canConfirmFulfillmentRemoval={canConfirmCancelledGuideFulfillmentRemoval} canAssignItems={canAssignCancelledGuideItems} viewerDeptCode={viewerDeptCode} />
        </>
      )}
      {tab === "solicitud" && (canSubmitFulfillmentRequest || canViewFulfillmentRequests) && (
        <>
          <TabGuide storageKey="merchoutflow-solicitud">
            {canSubmitFulfillmentRequest
              ? "Sube los PDF de guías de Dropi (y el Excel de Rocket) de cada corte. DAFLOW lo agrupa por el ID de INVESTOCK, abre los combos, lo reparte por transportadora y separa las garantías. Revisa y presiona \"Enviar a Inventario\" — después ya no se puede cambiar."
              : "Los cortes que envía Fulfillment, agrupados por el ID de INVESTOCK y repartidos por transportadora. Daniel imprime el manifiesto; el equipo escanea el QR de la percha y escribe cuántos sacó; Daniel compara y confirma — recién ahí se descuenta del Kardex."}
          </TabGuide>
          <FulfillmentRequestPanel canSubmit={canSubmitFulfillmentRequest} />
        </>
      )}
      {tab === "historial" && canView && (
        <>
          <TabGuide storageKey="merchoutflow-historial">Consulta acá el registro completo de egresos, con trazabilidad de quién capturó cada uno.</TabGuide>
          <HistoryList />
        </>
      )}
    </div>
  );
}
