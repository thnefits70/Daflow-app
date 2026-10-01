"use client";

import { useEffect, useState } from "react";
import { useB2BAdvisorLabel } from "@/lib/useB2BAdvisorLabel";
import { B2BAdvisorName } from "@/components/shared/B2BAdvisorName";
import { formatDateTime } from "@/lib/formatDateTime";
import { CatalogCode } from "@/components/shared/CatalogCode";
import { ExpandableName } from "@/components/ui/ExpandableName";
import { carrierLabel } from "@/lib/carriers";

type Sale = {
  id: string;
  code: string;
  name: string;
  quantity: number;
  guideNumbers: string[];
  carriers: string[];
  createdAt: string;
  reportedByName: string | null;
  delistedAt: string | null;
  delistedByName: string | null;
  orderCancelledAt: string | null;
  orderCancelledByName: string | null;
};

// "GINTRACOM 1" → "Gintracom 1"
function carrierText(c: string) {
  const i = c.lastIndexOf(" ");
  return i > 0 ? `${carrierLabel(c.slice(0, i))} ${c.slice(i + 1)}` : c;
}

// Pedido del usuario 2026-09-30 (caso 168766 Mesa Auxiliar Doble Repisa):
// un cliente compró en Dropi un producto que no tenemos ni vamos a comprar.
// Yair lo marca al subir el PDF de guías. Dos pasos, cada uno con su botón:
// Heidy da de baja el producto en Dropi (y cancela el pedido), y Bryan Ríos
// confirma que la gente de Dropi ya anuló la guía generada.
type StepKind = "delist" | "order";

export function DropiDiscontinuedSection({ canDelist }: { canDelist: boolean }) {
  const b2b = useB2BAdvisorLabel();
  const [rows, setRows] = useState<Sale[] | null>(null);
  const [canCancelOrder, setCanCancelOrder] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  function load() {
    fetch("/api/dropi-discontinued-sales")
      .then((r) => (r.ok ? r.json() : { rows: [], canCancelOrder: false }))
      .then((d: { rows: Sale[]; canCancelOrder: boolean }) => {
        setRows(d.rows);
        setCanCancelOrder(d.canCancelOrder);
      })
      .catch(() => setRows([]));
  }
  useEffect(load, []);

  async function confirm(kind: StepKind, id: string) {
    setSaving(true);
    setErr("");
    try {
      const res = await fetch(`/api/dropi-discontinued-sales/${id}/${kind === "delist" ? "delist" : "order-cancelled"}`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "No se pudo guardar.");
      setConfirming(null);
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setSaving(false);
    }
  }

  if (!rows || rows.length === 0) return null;
  const isDone = (r: Sale) => !!r.delistedAt && !!r.orderCancelledAt;
  const pending = rows.filter((r) => !isDone(r));
  const done = rows.filter(isDone);

  const step = (r: Sale, kind: StepKind) => {
    const cfg =
      kind === "delist"
        ? {
            at: r.delistedAt,
            by: r.delistedByName,
            doneText: "Producto dado de baja en Dropi",
            can: canDelist,
            button: "Ya lo di de baja en Dropi",
            question: "¿Estás seguro de que ya diste de baja el producto en Dropi?",
            yes: "Sí, ya lo di de baja",
            waiting: `${b2b.The}: dar de baja el producto en Dropi y cancelar el pedido.`,
          }
        : {
            at: r.orderCancelledAt,
            by: r.orderCancelledByName,
            doneText: "Dropi anuló la guía",
            can: canCancelOrder,
            button: "Dropi ya anuló la guía",
            question: "¿Estás seguro de que la gente de Dropi ya anuló esta guía?",
            yes: "Sí, ya la anularon",
            waiting: "Bryan: gestionar con la gente de Dropi que anulen la guía.",
          };
    const key = `${kind}:${r.id}`;
    if (cfg.at) {
      return (
        <div className="text-[11px] text-teal font-semibold mt-1">
          ✓ {cfg.doneText} · {cfg.by ?? "—"} · {formatDateTime(cfg.at)}
        </div>
      );
    }
    if (!cfg.can) {
      return (
        <div className="text-[11px] mt-1" style={{ color: "var(--color-gold)" }}>
          Pendiente — {cfg.waiting}
        </div>
      );
    }
    if (confirming === key) {
      return (
        <div className="bg-cloud rounded p-2.5 mt-2">
          <div className="text-[12px] mb-2">{cfg.question}</div>
          {err && <div className="text-red text-[11px] mb-1.5">{err}</div>}
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={saving}
              className="rounded border border-teal bg-teal px-3 py-1.5 text-[12px] font-bold text-navy cursor-pointer disabled:opacity-50"
              onClick={() => confirm(kind, r.id)}
            >
              {saving ? "Guardando…" : cfg.yes}
            </button>
            <button type="button" className="rounded border border-rule px-3 py-1.5 text-[12px] font-semibold cursor-pointer" onClick={() => setConfirming(null)}>
              Cancelar
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="mt-2 flex items-center gap-2 flex-wrap">
        <span className="text-[11px]" style={{ color: "var(--color-gold)" }}>
          {cfg.waiting}
        </span>
        <button
          type="button"
          className="rounded border border-teal px-3 py-1.5 text-[12px] font-bold text-teal cursor-pointer"
          onClick={() => {
            setErr("");
            setConfirming(key);
          }}
        >
          {cfg.button}
        </button>
      </div>
    );
  };

  const card = (r: Sale) => (
    <div key={r.id} className={`bg-surface border rounded-md p-3.5 ${isDone(r) ? "border-rule" : "border-red/50"}`}>
      <div className="text-[13px] font-semibold flex items-center gap-1.5 flex-wrap min-w-0 mb-1">
        <CatalogCode code={r.code} />
        <ExpandableName text={r.name} />
        <span className="font-mono text-[12px] ml-auto">{r.quantity} unid.</span>
      </div>
      <div className="text-[12px] text-ink mb-1">
        {r.guideNumbers.length > 0 ? `Guía ${r.guideNumbers.join(", ")}` : "Guía no leída"}
        {r.carriers.length > 0 ? ` · ${r.carriers.map(carrierText).join(" · ")}` : ""} — no sale, no lo tenemos.
      </div>
      <div className="text-[11px] text-steel">
        Marcó {r.reportedByName ?? "—"} al subir las guías · {formatDateTime(r.createdAt)}
      </div>
      {step(r, "delist")}
      {step(r, "order")}
    </div>
  );

  return (
    <div className="mb-7">
      <div className="font-display font-bold text-[14px] mb-1">Vendidos en Dropi pero dados de baja ({pending.length} pendientes)</div>
      <div className="text-[12px] text-steel mb-2.5">
        Un cliente compró un producto que no tenemos ni vamos a comprar. Ese pedido no sale. <B2BAdvisorName capital /> da de baja el producto en Dropi y cancela el pedido; como la
        guía ya se generó, Bryan gestiona con la gente de Dropi que la anulen. Cada uno marca su paso aquí.
      </div>
      <div className="flex flex-col gap-2.5 mb-3">{pending.map(card)}</div>
      {done.length > 0 && (
        <details>
          <summary className="text-[12px] text-steel cursor-pointer mb-2">Ya resueltos ({done.length})</summary>
          <div className="flex flex-col gap-2">{done.map(card)}</div>
        </details>
      )}
    </div>
  );
}
