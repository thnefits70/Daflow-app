"use client";

import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { ProcessEditor, type ProcessDTO } from "@/components/process/ProcessEditor";

export function UpdateGate({
  updateId,
  processTitle,
  note,
  createdAt,
  process,
  remaining,
  onAck,
  onSnooze,
  onDismissSession,
}: {
  updateId: string;
  processTitle: string;
  note: string;
  createdAt: string;
  process: ProcessDTO | null;
  remaining: number;
  onAck: () => void;
  onSnooze: (hours: number) => void;
  onDismissSession: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const ack = async () => {
    setBusy(true);
    await fetch(`/api/updates/${updateId}/ack`, { method: "POST" });
    setBusy(false);
    onAck();
  };

  const snooze = async (hours: number) => {
    setBusy(true);
    await fetch("/api/me/snooze", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hours }),
    });
    setBusy(false);
    onSnooze(hours);
  };

  return (
    <div className="max-w-3xl mx-auto py-2.5">
      <div className="bg-surface border border-rule rounded" style={{ borderLeft: "4px solid #14C7C7" }}>
        <div className="p-6 pb-0">
          <div className="font-mono text-[10.5px] text-teal tracking-[.08em] mb-1">ACTUALIZACIÓN OBLIGATORIA</div>
          <h2 className="font-display text-[20px] font-bold mb-1">{processTitle}</h2>
          <div className="text-[12px] text-steel mb-3">
            Actualizado el {new Date(createdAt).toLocaleDateString()} · Debes revisarlo para continuar
            {remaining > 1 ? ` (quedan ${remaining} actualizaciones pendientes)` : ""}
          </div>
          {note && (
            <div className="bg-cloud border border-rule rounded p-3 text-[13px] text-ink/90 mb-4">
              <span className="font-semibold">Qué cambió: </span>
              {note}
            </div>
          )}
        </div>

        {process ? (
          <div className="px-6">
            <ProcessEditor process={process} backHref="" editable={false} hideBackLink />
          </div>
        ) : (
          <div className="px-6 pb-4 text-steel text-[13px]">
            Este proceso ya no existe, pero debes confirmar que lo viste.
          </div>
        )}

        <div className="p-6 pt-4">
          <button
            type="button"
            disabled={busy}
            className="w-full flex items-center justify-center gap-1.5 rounded border border-blue bg-blue px-5 py-3 text-[13.5px] font-semibold text-white cursor-pointer disabled:opacity-60"
            onClick={ack}
          >
            <CheckCircle2 size={15} /> Ya lo revisé, marcar como leído
          </button>

          <div className="border-t border-rule pt-3 mt-3.5">
            <div className="text-[11.5px] text-steel mb-2">¿Tienes una urgencia ahora mismo? Puedes posponerlo:</div>
            <div className="flex gap-2 flex-wrap">
              <button type="button" disabled={busy} className="text-[12px] border border-rule rounded px-3 py-1.5 cursor-pointer" onClick={() => snooze(1)}>
                Recordarme en 1 hora
              </button>
              <button type="button" disabled={busy} className="text-[12px] border border-rule rounded px-3 py-1.5 cursor-pointer" onClick={() => snooze(3)}>
                Recordarme en 3 horas
              </button>
              <button type="button" className="text-[12px] border border-rule rounded px-3 py-1.5 cursor-pointer" onClick={onDismissSession}>
                Preguntarme la próxima vez que inicie sesión
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
