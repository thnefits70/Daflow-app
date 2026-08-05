"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type PendingExceptionDTO = { id: string; groupId: string; label: string; reason: string; requestedByName: string };

// Solo el dueño ve esto — confirmado 2026-08-05: aprobar/rechazar la
// solicitud de un segundo pago de flete real sobre una orden ya pagada.
export function PettyCashExceptionsPanel({ exceptions }: { exceptions: PendingExceptionDTO[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);

  if (exceptions.length === 0) return null;

  async function decide(id: string, decision: "approved" | "rejected") {
    setBusyId(id);
    await fetch(`/api/petty-cash/exceptions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    setBusyId(null);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2.5 mb-4">
      {exceptions.map((e) => (
        <div key={e.id} className="bg-surface border border-gold/40 rounded-md p-4">
          <div className="text-[12.5px] font-semibold mb-1" style={{ color: "#D9A441" }}>
            ⏳ Excepción pendiente — {e.requestedByName}, {e.label}
          </div>
          <div className="text-[12px] text-steel bg-cloud rounded p-2.5 mb-2.5">&quot;{e.reason}&quot;</div>
          <div className="flex gap-2">
            <button type="button" disabled={busyId === e.id} className="rounded bg-green/15 text-green border border-green/40 px-3.5 py-1.5 text-[11.5px] font-semibold cursor-pointer disabled:opacity-60" onClick={() => decide(e.id, "approved")}>
              Aprobar — permitir 2do pago
            </button>
            <button type="button" disabled={busyId === e.id} className="rounded bg-red/15 text-red border border-red/40 px-3.5 py-1.5 text-[11.5px] font-semibold cursor-pointer disabled:opacity-60" onClick={() => decide(e.id, "rejected")}>
              Rechazar
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
