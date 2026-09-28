"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, FileText, TriangleAlert } from "lucide-react";
import { formatDateTime } from "@/lib/formatDateTime";

function isPdf(url: string) {
  return /\.pdf($|\?)/i.test(url);
}

// El comprobante que subió el admin al aprobar — el colaborador lo ve para
// comprobar que le llegó (confirmado 2026-09-28).
export function AdvanceProof({ url }: { url: string }) {
  if (isPdf(url)) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-blue underline decoration-dotted">
        <FileText size={13} /> Ver comprobante (PDF)
      </a>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className="block">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="Comprobante de transferencia" className="max-h-[260px] max-w-full rounded border border-rule object-contain bg-cloud" />
    </a>
  );
}

export async function sendAdvanceReceipt(id: string, received: boolean) {
  const res = await fetch(`/api/salary-advances/${id}/receipt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ received }),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => null);
    throw new Error(d?.error ?? "No se pudo guardar.");
  }
}

// Botones "Sí, me llegó" / "No me llegó". Si ya avisó que no le llegó,
// solo queda el "Sí" por si después le llega.
export function AdvanceReceiptButtons({ id, issueReported, onDone }: { id: string; issueReported: boolean; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function send(received: boolean) {
    if (!received && !window.confirm("¿Seguro que NO te llegó? Se le avisa al admin para que revise la transferencia.")) return;
    setBusy(true);
    setErr("");
    try {
      await sendAdvanceReceipt(id, received);
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <div>
      <div className="flex gap-2 flex-wrap">
        <button type="button" disabled={busy} onClick={() => send(true)} className="inline-flex items-center gap-1.5 text-[13px] font-bold bg-green text-white rounded-md px-4 py-2 cursor-pointer disabled:opacity-40">
          <CheckCircle2 size={15} /> Sí, me llegó
        </button>
        {!issueReported && (
          <button type="button" disabled={busy} onClick={() => send(false)} className="text-[12.5px] font-semibold text-red border border-red/40 rounded-md px-3 py-2 cursor-pointer disabled:opacity-40">
            No me llegó
          </button>
        )}
      </div>
      {err && <div className="text-red text-[12px] mt-1.5">{err}</div>}
    </div>
  );
}

type DueAdvance = { id: string; amount: number; approvedAt: string; transferProofUrl: string | null };

// Ventana que no se puede cerrar: aparece cuando pasaron 24 h desde que se
// aprobó el anticipo y el colaborador todavía no confirmó que le llegó.
export function SalaryAdvanceReceiptGate() {
  const [queue, setQueue] = useState<DueAdvance[]>([]);

  useEffect(() => {
    fetch("/api/salary-advances/receipt-due")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => setQueue(d.items ?? []))
      .catch(() => {});
  }, []);

  const current = queue[0];
  if (!current) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-4">
      <div className="bg-surface border border-rule rounded-lg p-5 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center gap-2 text-gold text-[12px] font-semibold uppercase tracking-wide mb-2">
          <TriangleAlert size={15} /> Confirmación obligatoria
        </div>
        <div className="text-[15px] font-bold text-ink mb-1">¿Te llegó tu anticipo de ${current.amount.toFixed(2)}?</div>
        <div className="text-[12.5px] text-steel mb-3 leading-relaxed">
          Se te transfirió el {formatDateTime(current.approvedAt)}. Revisá tu cuenta y el comprobante, y confirmá con un
          clic. Para seguir usando la app tenés que responder.
        </div>
        {current.transferProofUrl ? (
          <div className="mb-4"><AdvanceProof url={current.transferProofUrl} /></div>
        ) : (
          <div className="text-[12px] text-steel-dim mb-4">Este anticipo no tiene comprobante cargado.</div>
        )}
        <AdvanceReceiptButtons id={current.id} issueReported={false} onDone={() => setQueue((q) => q.slice(1))} />
      </div>
    </div>
  );
}
