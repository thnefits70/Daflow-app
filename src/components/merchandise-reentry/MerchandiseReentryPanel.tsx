"use client";

import { useEffect, useState } from "react";
import { CaptureFlow } from "./CaptureFlow";
import { ReviewInbox } from "./ReviewInbox";
import { CloseQueues } from "./CloseQueues";
import { WeeklyDamageControl } from "./WeeklyDamageControl";
import { HistoryList } from "./HistoryList";
import { JustCatalogPanel } from "./JustCatalogPanel";
import { TabGuide } from "@/components/shared/TabGuide";

type Tab = "capturar" | "revision" | "cierre" | "danos" | "productos" | "historial";

export function MerchandiseReentryPanel({
  canCapture,
  canApprove,
  canAct = false,
  canClose,
  canManageJustUpload = false,
  canManageJustCatalog = false,
}: {
  canCapture: boolean;
  canApprove: boolean;
  canAct?: boolean;
  canClose: boolean;
  canManageJustUpload?: boolean;
  canManageJustCatalog?: boolean;
}) {
  const canSeeCierre = canClose || canManageJustUpload;
  const defaultTab: Tab = canCapture ? "capturar" : canApprove ? "revision" : canSeeCierre ? "cierre" : "historial";
  const [tab, setTab] = useState<Tab>(defaultTab);

  // Confirmado 2026-08-19: pedido explícito del usuario — el atajo de
  // "Pendientes" en Inicio llega con ?tab=revision para que Daniel entre
  // directo a lo que tiene que gestionar, sin que se quede en "Capturar"
  // (su pestaña por defecto, ya que también es parte del equipo).
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab") as Tab | null;
    if (t === "revision" && canApprove) setTab("revision");
    else if (t === "cierre" && canSeeCierre) setTab("cierre");
    else if (t === "danos" && (canApprove || canClose)) setTab("danos");
    else if (t === "productos" && (canApprove || canClose)) setTab("productos");
    else if (t === "capturar" && canCapture) setTab("capturar");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tabs: { id: Tab; label: string }[] = [
    ...(canCapture ? [{ id: "capturar" as const, label: "Capturar" }] : []),
    ...(canApprove ? [{ id: "revision" as const, label: "Revisión" }] : []),
    ...(canSeeCierre ? [{ id: "cierre" as const, label: "Cierre" }] : []),
    ...(canApprove || canClose ? [{ id: "danos" as const, label: "Control de Daños" }] : []),
    ...(canApprove || canClose ? [{ id: "productos" as const, label: "Base de datos de productos" }] : []),
    { id: "historial" as const, label: "Historial" },
  ];

  return (
    <div>
      <h1 className="font-display text-[22px] font-bold mb-1">Reingreso de Mercadería</h1>
      <p className="text-[13px] text-steel mb-5">Devoluciones de pedidos no entregados que regresan a bodega.</p>

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

      {tab === "capturar" && canCapture && (
        <>
          <TabGuide storageKey="merchreentry-capturar">
            Registra acá lo que vuelve a bodega de un pedido no entregado: identifica cada producto (o descríbelo si el catálogo no lo tiene), marca cuántas unidades vienen buenas y cuántas dañadas, y envía el lote cuando esté completo. Lo que no se pueda identificar, Daniel lo revisa después en &quot;Revisión&quot;.
          </TabGuide>
          <CaptureFlow />
        </>
      )}
      {tab === "revision" && canApprove && (
        <>
          <TabGuide storageKey="merchreentry-revision">
            {canAct ? (
              <>Acá apruebas los lotes que Inventario captura. &quot;Listos para aprobar&quot; ya tienen todo identificado y sin daños pendientes — solo confirmas. &quot;Requiere revisión&quot; necesita que vincules el producto correcto o decidas si un daño se solucionó, antes de poder aprobarlo.</>
            ) : (
              <>Supervisas en modo lectura los lotes que Inventario captura. Aprobar lotes, vincular productos o resolver daños es exclusivo del líder de Inventario (Daniel).</>
            )}
          </TabGuide>
          <ReviewInbox canAct={canAct} />
        </>
      )}
      {tab === "cierre" && canSeeCierre && (
        <>
          <TabGuide storageKey="merchreentry-cierre">
            {canManageJustUpload ? (
              <>Acá se agrupan por producto las unidades buenas ya aprobadas. Cuando un producto llega a la cantidad mínima puedes subir su stock a Just — solo en el día habilitado de la semana.</>
            ) : (
              <>Vista de solo lectura de las unidades buenas ya aprobadas, agrupadas por producto y listas para subir a Just. Subir el stock es exclusivo de Nairoby o Daniel.</>
            )}
          </TabGuide>
          <CloseQueues canManage={canManageJustUpload} />
        </>
      )}
      {tab === "danos" && (canApprove || canClose) && (
        <>
          <TabGuide storageKey="merchreentry-danos">
            {canAct && !canClose && (
              <>Cada semana se cierra el sábado con lo dañado que no se pudo solucionar. Te toca darlo de baja en el sistema Just — al confirmar, el lote pasa a Nairoby para la verificación física y la disposición final.</>
            )}
            {canClose && !canAct && (
              <>Acá verificas físicamente lo que ya se dio de baja en Just, y decides si cada producto se destruye o pasa a la percha de repuestos.</>
            )}
            {canAct && canClose && (
              <>Ves las dos partes del ciclo semanal: dar de baja en Just lo que no se solucionó, y luego verificar físicamente + decidir destrucción o percha de repuestos.</>
            )}
            {!canAct && !canClose && (
              <>Vista de solo lectura del ciclo semanal de productos dañados: baja en Just (Daniel), verificación física y disposición final (Nairoby).</>
            )}
          </TabGuide>
          <WeeklyDamageControl canAct={canAct} canApprove={canApprove} canClose={canClose} />
        </>
      )}
      {tab === "productos" && (canApprove || canClose) && (
        <>
          <TabGuide storageKey="merchreentry-productos">
            {canManageJustCatalog ? (
              <>Este es el catálogo maestro sincronizado con Just. Sube acá el archivo exportado de Just para comparar contra lo que ya existe — el sistema te muestra qué cambió antes de aplicar nada.</>
            ) : (
              <>Consulta acá el catálogo de productos sincronizado con Just, en modo lectura. Subir actualizaciones es exclusivo de Daniel o admin.</>
            )}
          </TabGuide>
          <JustCatalogPanel canManage={canManageJustCatalog} />
        </>
      )}
      {tab === "historial" && (
        <>
          <TabGuide storageKey="merchreentry-historial">
            Consulta acá el registro completo de lotes ya cerrados, para buscar o revisar algo pasado.
          </TabGuide>
          <HistoryList />
        </>
      )}
    </div>
  );
}
