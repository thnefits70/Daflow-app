"use client";

import { useState } from "react";
import { CaptureFlow } from "./CaptureFlow";
import { ReviewInbox } from "./ReviewInbox";
import { CloseQueues } from "./CloseQueues";
import { HistoryList } from "./HistoryList";

type Tab = "capturar" | "revision" | "cierre" | "historial";

export function MerchandiseReentryPanel({
  canCapture,
  canApprove,
  canClose,
}: {
  canCapture: boolean;
  canApprove: boolean;
  canClose: boolean;
}) {
  const defaultTab: Tab = canCapture ? "capturar" : canApprove ? "revision" : canClose ? "cierre" : "historial";
  const [tab, setTab] = useState<Tab>(defaultTab);

  const tabs: { id: Tab; label: string }[] = [
    ...(canCapture ? [{ id: "capturar" as const, label: "Capturar" }] : []),
    ...(canApprove ? [{ id: "revision" as const, label: "Revisión" }] : []),
    ...(canClose ? [{ id: "cierre" as const, label: "Cierre" }] : []),
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
      {tab === "revision" && canApprove && <ReviewInbox />}
      {tab === "cierre" && canClose && <CloseQueues />}
      {tab === "historial" && <HistoryList />}
    </div>
  );
}
