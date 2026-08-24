"use client";

import { useEffect, useState } from "react";
import { CaptureFlow } from "./CaptureFlow";
import { ReviewInbox } from "./ReviewInbox";
import { CloseQueues } from "./CloseQueues";
import { WeeklyDamageControl } from "./WeeklyDamageControl";
import { HistoryList } from "./HistoryList";
import { JustCatalogPanel } from "./JustCatalogPanel";

type Tab = "capturar" | "revision" | "cierre" | "danos" | "productos" | "historial";

export function MerchandiseReentryPanel({
  canCapture,
  canApprove,
  canAct = false,
  canClose,
  canManageJustCatalog = false,
}: {
  canCapture: boolean;
  canApprove: boolean;
  canAct?: boolean;
  canClose: boolean;
  canManageJustCatalog?: boolean;
}) {
  const defaultTab: Tab = canCapture ? "capturar" : canApprove ? "revision" : canClose ? "cierre" : "historial";
  const [tab, setTab] = useState<Tab>(defaultTab);

  // Confirmado 2026-08-19: pedido explícito del usuario — el atajo de
  // "Pendientes" en Inicio llega con ?tab=revision para que Daniel entre
  // directo a lo que tiene que gestionar, sin que se quede en "Capturar"
  // (su pestaña por defecto, ya que también es parte del equipo).
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab") as Tab | null;
    if (t === "revision" && canApprove) setTab("revision");
    else if (t === "cierre" && canClose) setTab("cierre");
    else if (t === "danos" && (canApprove || canClose)) setTab("danos");
    else if (t === "productos" && (canApprove || canClose)) setTab("productos");
    else if (t === "capturar" && canCapture) setTab("capturar");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tabs: { id: Tab; label: string }[] = [
    ...(canCapture ? [{ id: "capturar" as const, label: "Capturar" }] : []),
    ...(canApprove ? [{ id: "revision" as const, label: "Revisión" }] : []),
    ...(canClose ? [{ id: "cierre" as const, label: "Cierre" }] : []),
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

      {tab === "capturar" && canCapture && <CaptureFlow />}
      {tab === "revision" && canApprove && <ReviewInbox canAct={canAct} />}
      {tab === "cierre" && canClose && <CloseQueues />}
      {tab === "danos" && (canApprove || canClose) && <WeeklyDamageControl canAct={canAct} canApprove={canApprove} canClose={canClose} />}
      {tab === "productos" && (canApprove || canClose) && <JustCatalogPanel canManage={canManageJustCatalog} />}
      {tab === "historial" && <HistoryList />}
    </div>
  );
}
