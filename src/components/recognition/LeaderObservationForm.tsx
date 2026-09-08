"use client";

import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";

type ObservationData = { month: string; positiveComment: string; improvementComment: string; submitted: boolean };

// Observación libre (comment-only, no afecta puntaje) — reusada para "dejarle
// una observación a otro líder" y "dejarle una observación al admin". Mismo
// candado: si quieres pedir una mejora, primero tenés que decir algo
// positivo — nunca se puede enviar solo lo negativo.
export function LeaderObservationForm({
  fetchUrl,
  submitUrl,
  extraBody,
  targetName,
}: {
  fetchUrl: string;
  submitUrl: string;
  extraBody?: Record<string, string>;
  targetName: string;
}) {
  const [data, setData] = useState<ObservationData | null>(null);
  const [positiveComment, setPositiveComment] = useState("");
  const [improvementComment, setImprovementComment] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setLoading(true);
    setSaved(false);
    fetch(fetchUrl)
      .then(async (res) => {
        const d = await res.json();
        if (!res.ok) {
          setErr(d?.error ?? "No se pudo cargar.");
          return;
        }
        setData(d as ObservationData);
        setPositiveComment(d.positiveComment ?? "");
        setImprovementComment(d.improvementComment ?? "");
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchUrl]);

  const canSubmit = positiveComment.trim().length >= 3;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setErr("");
    const res = await fetch(submitUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...extraBody, positiveComment: positiveComment.trim(), improvementComment: improvementComment.trim() || undefined }),
    });
    setBusy(false);
    if (!res.ok) {
      const errData = await res.json().catch(() => null);
      setErr(errData?.error ?? "No se pudo guardar.");
      return;
    }
    setSaved(true);
  };

  if (loading) return <div className="text-[13px] text-steel">Cargando…</div>;
  if (err && !data) return <div className="text-red text-[12.5px]">{err}</div>;
  if (!data) return null;

  if (saved || data.submitted) {
    return (
      <div className="bg-teal/10 border border-teal rounded-md p-5 text-center">
        <CheckCircle2 size={22} className="text-teal mx-auto mb-1.5" />
        <div className="font-semibold text-[14px]">Observación enviada</div>
        <div className="text-[12.5px] text-steel mt-0.5">
          Puedes editarla en cualquier momento este mes — se revela junto con el resto cuando se confirme el podio.
        </div>
        {!saved && (
          <button type="button" className="mt-3 text-[12.5px] font-semibold text-blue cursor-pointer" onClick={() => setSaved(false)}>
            Editar mi observación
          </button>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="bg-surface border border-rule rounded-md p-4.5 mb-3">
        <label className="block mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-steel">Algo positivo (obligatorio)</label>
        <div className="text-[11.5px] text-steel mb-2">
          No afecta ningún puntaje — es solo una observación para {targetName}, anónima, que se revela al confirmar el podio del mes.
        </div>
        <textarea
          className="w-full rounded border border-rule px-2.5 py-2 text-[13px] bg-surface"
          rows={2}
          maxLength={600}
          value={positiveComment}
          onChange={(e) => setPositiveComment(e.target.value)}
        />
      </div>

      <div className="bg-surface border border-rule rounded-md p-4.5 mb-5">
        <label className="block mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-steel">Algo por mejorar (opcional)</label>
        <textarea
          className="w-full rounded border border-rule px-2.5 py-2 text-[13px] bg-surface"
          rows={2}
          maxLength={600}
          placeholder="Solo si quieres sumar algo — necesitas escribir primero algo positivo."
          value={improvementComment}
          onChange={(e) => setImprovementComment(e.target.value)}
        />
      </div>

      {err && <div className="text-red text-[12.5px] mb-3">{err}</div>}

      <button
        type="button"
        disabled={!canSubmit || busy}
        className="inline-flex items-center gap-1.5 rounded border border-blue bg-blue px-4 py-2.5 text-[13px] font-semibold text-white cursor-pointer disabled:opacity-50"
        onClick={submit}
      >
        {busy ? "Guardando…" : "Enviar observación"}
      </button>
    </div>
  );
}
