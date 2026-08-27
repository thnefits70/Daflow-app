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
import { PurchaseJustaPanel } from "./PurchaseJustaPanel";
import { TabGuide } from "@/components/shared/TabGuide";

type Tab = "solicitar" | "mias" | "comparar" | "aprobacion" | "inventario" | "justa" | "finanzas" | "urgentes" | "creditos" | "auditoria";

// Confirmado 2026-07-30: una sola pantalla para todo el módulo — las
// pestañas que ve cada persona dependen de lo que puede hacer (admin ve
// todas; Bryan/Nairoby ven Solicitar; Daniel ve Inventario; Nairoby además
// ve Finanzas) — igual que ya funciona Proveedores en /area y /admin.
export function PurchaseControlPanel({
  deptId,
  canSubmit,
  canReview,
  canReceive,
  canReceiveTeam,
  canApproveReceiving,
  canInvoice,
  canPayMerchandise,
  isAdmin,
}: {
  deptId: string;
  canSubmit: boolean;
  canReview: boolean;
  canReceive: boolean;
  canReceiveTeam: boolean;
  canApproveReceiving: boolean;
  canInvoice: boolean;
  canPayMerchandise: boolean;
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
    // Confirmado 2026-08-18: pedido explícito del usuario — pestaña propia,
    // separada de "Inventario", exclusiva de Daniel (canApproveReceiving) —
    // su checklist personal para pasar lo aprobado al sistema Just.
    ...(canApproveReceiving ? [{ key: "justa" as Tab, label: "Just" }] : []),
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

      {tab === "solicitar" && (
        <>
          <TabGuide storageKey="compras-solicitar">
            Arma acá una nueva solicitud de compra: producto, cantidad, costo, proveedor y la cotización. Se envía a aprobación del admin.
          </TabGuide>
          <PurchaseRequestForm deptId={deptId} isAdmin={isAdmin} />
        </>
      )}
      {tab === "mias" && (
        <>
          <TabGuide storageKey="compras-mias">
            Sigue acá el estado de tus solicitudes ya enviadas. Si el admin rechaza una, la puedes corregir y reenviar desde aquí sin perder lo que ya llenaste.
          </TabGuide>
          <MyPurchaseRequests onResubmit={handleResubmit} isAdmin={isAdmin} />
        </>
      )}
      {tab === "comparar" && (
        <>
          <TabGuide storageKey="compras-comparar">
            Busca acá el historial de precios de un producto entre todos los proveedores a los que se le ha comprado, para saber a quién conviene comprarle antes de solicitar.
          </TabGuide>
          <PurchasePriceExplorer />
        </>
      )}
      {tab === "aprobacion" && (
        <>
          <TabGuide storageKey="compras-aprobacion">
            Apruebas o rechazas las solicitudes de compra. El sistema lee la cotización subida con IA y te avisa si el total no coincide con lo declarado — revísalo antes de aprobar.
          </TabGuide>
          <PurchaseApprovalInbox />
        </>
      )}
      {tab === "urgentes" && (
        <>
          <TabGuide storageKey="compras-urgentes">
            Acá resuelves los &quot;informar urgente&quot; que sube Daniel cuando algo llega mal: reparte la cantidad afectada entre crédito, cambio, reembolso o pérdida — nunca a mano, siempre según el costo real de la cotización. El reembolso lo confirma el admin en su banco.
          </TabGuide>
          <PurchaseUrgentReportsPanel isAdmin={isAdmin} />
        </>
      )}
      {tab === "creditos" && (
        <>
          <TabGuide storageKey="compras-creditos">
            Consulta acá todo el crédito vivo con proveedores, de cualquier operación. Desaparece de la lista en cuanto se aplica realmente a un pago.
          </TabGuide>
          <PurchaseCreditsPanel />
        </>
      )}
      {tab === "inventario" && (
        <>
          <TabGuide storageKey="compras-inventario">
            {canApproveReceiving ? (
              <>
                Acá el equipo registra la recepción con foto y video de cada pedido pagado. Como líder, tu aprobación final es la que cierra cada recepción — sin eso, el pedido queda pendiente de revisión.
                <br /><br />
                Si algo llega mal, el equipo te manda un &quot;Informar urgente&quot; con lo que ellos contaron y lo dañado/incompleto/diferente que vieron. Ahí te va a salir cuánto se pidió comprar y cuánto contaron ellos, más una casilla de <strong>Cantidad faltante</strong> ya calculada — la podés dejar igual o cambiarla, y antes de mandarla a Compras te va a pedir confirmar con un clic aparte para que no se envíe por error.
              </>
            ) : canReceiveTeam ? (
              <>
                Registra acá la recepción de cada pedido pagado: foto y video del producto que llega. Daniel da la aprobación final.
                <br /><br />
                Si lo que contaste no coincide con lo cargado, no hace falta que sepas por qué ni cuánto exactamente — usa &quot;🚨 Informar urgente&quot;, pon la cantidad que contaste y marca solo lo que sí podés ver (dañado, producto incompleto o distinto). No necesitás saber cuánto se pidió comprar, eso lo revisa Daniel.
              </>
            ) : (
              <>Vista de solo lectura de lo que el equipo de Inventario va recibiendo y aprobando. Recibir y aprobar es exclusivo del equipo de Inventario y su líder.</>
            )}
          </TabGuide>
          <PurchaseReceivingPanel isAdmin={isAdmin} canReceiveTeam={canReceiveTeam} canApprove={canApproveReceiving} />
        </>
      )}
      {tab === "justa" && (
        <>
          <TabGuide storageKey="compras-justa">
            Tu checklist personal: marca acá, uno por uno, lo que ya aprobaste y ya ingresaste al sistema Just. Es solo tuyo, no del equipo.
          </TabGuide>
          <PurchaseJustaPanel />
        </>
      )}
      {tab === "finanzas" && (
        <>
          <TabGuide storageKey="compras-finanzas">
            {isAdmin ? (
              canPayMerchandise ? (
                <>Acá pagas la mercadería ya aprobada tú mismo. Registrar factura, pagar flete y marcar para revisar sigue siendo exclusivo de Nairoby (líder de Finanzas), vista de solo lectura para el resto.</>
              ) : (
                <>Vista de solo lectura de las facturas y pagos que va cerrando Finanzas. Registrar factura y marcar pagos es exclusivo de Nairoby (líder de Finanzas).</>
              )
            ) : (
              <>Sube acá la factura de cada pedido ya recibido — con eso se cierra el ciclo de la compra.</>
            )}
          </TabGuide>
          <PurchaseInvoicingPanel isAdmin={isAdmin} canPayMerchandise={canPayMerchandise} />
        </>
      )}
      {tab === "auditoria" && (
        <>
          <TabGuide storageKey="compras-auditoria">
            Historial de solo lectura de todo lo recibido y facturado, para buscar o auditar algo pasado sin poder editarlo.
          </TabGuide>
          <PurchaseAuditPanel />
        </>
      )}
    </div>
  );
}
