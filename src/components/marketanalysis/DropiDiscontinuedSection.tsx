"use client";

import { useEffect, useState } from "react";
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
};

// "GINTRACOM 1" → "Gintracom 1"
function carrierText(c: string) {
  const i = c.lastIndexOf(" ");
  return i > 0 ? `${carrierLabel(c.slice(0, i))} ${c.slice(i + 1)}` : c;
}

// Pedido del usuario 2026-09-30 (caso 168766 Mesa Auxiliar Doble Repisa):
// un cliente compró en Dropi un producto que no tenemos ni vamos a comprar.
// Yair lo marca al subir el PDF de guías; Heidy entra a Dropi, lo da de baja
// y lo marca acá. El resto del equipo lo ve para estar pendiente del pedido.
export function DropiDiscontinuedSection({ canDelist }: { canDelist: boolean }) {
  const [rows, setRows] = useState<Sale[] | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  function load() {
    fetch("/api/dropi-discontinued-sales")
      .then((r) => (r.ok ? r.json() : []))
      .then(setRows)
      .catch(() => setRows([]));
  }
  useEffect(load, []);

  async function delist(id: string) {
    setSaving(true);
    setErr("");
    try {
      const res = await fetch(`/api/dropi-discontinued-sales/${id}/delist`, { method: "POST" });
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
  const pending = rows.filter((r) => !r.delistedAt);
  const done = rows.filter((r) => r.delistedAt);

  const card = (r: Sale) => (
    <div key={r.id} className={`bg-surface border rounded-md p-3.5 ${r.delistedAt ? "border-rule" : "border-red/50"}`}>
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
      {r.delistedAt ? (
        <div className="text-[11px] text-teal font-semibold mt-1">
          Dado de baja en Dropi por {r.delistedByName ?? "—"} · {formatDateTime(r.delistedAt)}
        </div>
      ) : canDelist ? (
        confirming === r.id ? (
          <div className="bg-cloud rounded p-2.5 mt-2">
            <div className="text-[12px] mb-2">¿Estás seguro de que ya lo diste de baja en Dropi?</div>
            {err && <div className="text-red text-[11px] mb-1.5">{err}</div>}
            <div className="flex gap-1.5">
              <button
                type="button"
                disabled={saving}
                className="rounded border border-teal bg-teal px-3 py-1.5 text-[12px] font-bold text-navy cursor-pointer disabled:opacity-50"
                onClick={() => delist(r.id)}
              >
                {saving ? "Guardando…" : "Sí, ya lo di de baja"}
              </button>
              <button type="button" className="rounded border border-rule px-3 py-1.5 text-[12px] font-semibold cursor-pointer" onClick={() => setConfirming(null)}>
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="mt-2 rounded border border-teal px-3 py-1.5 text-[12px] font-bold text-teal cursor-pointer"
            onClick={() => {
              setErr("");
              setConfirming(r.id);
            }}
          >
            Ya lo di de baja en Dropi
          </button>
        )
      ) : (
        <div className="text-[11px] mt-1" style={{ color: "var(--color-gold)" }}>
          Esperando que Heidy lo dé de baja en Dropi.
        </div>
      )}
    </div>
  );

  return (
    <div className="mb-7">
      <div className="font-display font-bold text-[14px] mb-1">Vendidos en Dropi pero dados de baja ({pending.length} por dar de baja)</div>
      <div className="text-[12px] text-steel mb-2.5">
        Un cliente compró un producto que no tenemos ni vamos a comprar. Ese pedido no sale.{" "}
        {canDelist ? "Entra a Dropi, da de baja el producto y cancela el pedido; luego márcalo aquí." : "Heidy lo da de baja en Dropi."} Como la guía ya se generó, Bryan gestiona con la gente de Dropi que anulen ese pedido.
      </div>
      <div className="flex flex-col gap-2.5 mb-3">{pending.map(card)}</div>
      {done.length > 0 && (
        <details>
          <summary className="text-[12px] text-steel cursor-pointer mb-2">Ya dados de baja ({done.length})</summary>
          <div className="flex flex-col gap-2">{done.map(card)}</div>
        </details>
      )}
    </div>
  );
}
