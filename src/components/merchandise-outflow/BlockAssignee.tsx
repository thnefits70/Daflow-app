"use client";

import { useState } from "react";
import { UserRound } from "lucide-react";
import type { CompiledLot } from "./LotView";

// Pedido de Daniel 2026-09-26: a quién le toca sacar un bloque del corte.
// Daniel lo elige de una lista (mientras el corte está abierto); el resto
// solo ve el nombre.
export function BlockAssignee({ lot, carrier, onChanged }: { lot: CompiledLot; carrier: string; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const b = lot.blocks.find((x) => x.carrier === carrier);
  const myId = lot.viewer?.userId ?? null;
  const mine = !!myId && b?.assigneeId === myId;
  const canAssign = !!lot.viewer?.canConfirm && lot.status === "SENT" && !!lot.viewer.team;

  async function assign(assigneeId: string | null) {
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/fulfillment-lots/${lot.id}/blocks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ carrier, assigneeId }),
    });
    const json = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      setErr(json?.error ?? "No se pudo asignar.");
      return;
    }
    onChanged();
  }

  return (
    <span className="ml-auto flex items-center gap-1 text-[11.5px] normal-case tracking-normal font-normal">
      <UserRound size={12} className="text-steel" />
      {canAssign ? (
        <>
          <span className="text-steel">Saca:</span>
          <select
            disabled={busy}
            className="rounded border border-rule bg-surface px-1.5 py-0.5 text-[11.5px]"
            value={b?.assigneeId ?? ""}
            onChange={(e) => assign(e.target.value || null)}
          >
            <option value="">Sin asignar</option>
            {lot.viewer!.team!.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </>
      ) : (
        <span className={mine ? "font-bold text-teal" : b?.assigneeName ? "font-semibold" : "text-steel"}>
          {mine ? "Te toca a ti" : b?.assigneeName ? `Saca: ${b.assigneeName}` : "Sin asignar"}
        </span>
      )}
      {err && <span className="text-red">{err}</span>}
    </span>
  );
}
