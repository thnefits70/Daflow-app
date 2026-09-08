"use client";

import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { PILLAR_ACCENTS } from "@/lib/recognition";

type QuestionDTO = { id: string; text: string; score: number | null };
type FeedbackData = {
  month: string;
  questions: QuestionDTO[];
  positiveComment: string;
  improvementComment: string;
  submitted: boolean;
};

function ScorePicker({ value, onChange }: { value: number | null; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          className={`w-7 h-7 rounded-full text-[12px] font-semibold cursor-pointer border transition-colors ${
            value === n ? "bg-blue border-blue text-white" : "bg-surface border-rule text-steel hover:border-blue"
          }`}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

// Formulario de Liderazgo 360° reusado en dos lugares: un colaborador
// calificando a su propio líder (leader-feedback), o un líder calificando al
// admin (admin-feedback) — mismas 4 preguntas en primera persona, mismo par
// de comentarios (positivo obligatorio, mejora opcional), mismo anonimato
// para quien lo recibe.
export function LeadershipQuestionsForm({
  fetchUrl,
  submitUrl,
  extraBody,
  targetName,
  anonymousNote = "Tu nombre no se le muestra a la persona calificada.",
}: {
  fetchUrl: string;
  submitUrl: string;
  extraBody?: Record<string, string>;
  targetName: string;
  anonymousNote?: string;
}) {
  const [data, setData] = useState<FeedbackData | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [positiveComment, setPositiveComment] = useState("");
  const [improvementComment, setImprovementComment] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(fetchUrl)
      .then(async (res) => {
        const d = await res.json();
        if (!res.ok) {
          setErr(d?.error ?? "No se pudo cargar el formulario.");
          return;
        }
        setData(d as FeedbackData);
        setPositiveComment(d.positiveComment ?? "");
        setImprovementComment(d.improvementComment ?? "");
        const initial: Record<string, number> = {};
        for (const q of (d as FeedbackData).questions) {
          if (q.score !== null) initial[q.id] = q.score;
        }
        setAnswers(initial);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchUrl]);

  const allAnswered = data !== null && data.questions.every((q) => answers[q.id] != null);
  const canSubmit = allAnswered && positiveComment.trim().length >= 3;

  const submit = async () => {
    if (!data || !canSubmit) return;
    setBusy(true);
    setErr("");
    const scores = data.questions.map((q) => ({ questionId: q.id, score: answers[q.id] }));
    const res = await fetch(submitUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...extraBody, scores, positiveComment: positiveComment.trim(), improvementComment: improvementComment.trim() || undefined }),
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
        <div className="font-semibold text-[14px]">Calificación enviada</div>
        <div className="text-[12.5px] text-steel mt-0.5">
          Puedes editarla en cualquier momento este mes — se revela junto con el resto cuando se confirme el podio.
        </div>
        {!saved && (
          <button type="button" className="mt-3 text-[12.5px] font-semibold text-blue cursor-pointer" onClick={() => setSaved(false)}>
            Editar mi calificación
          </button>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="bg-surface border border-rule rounded-md p-4.5 mb-4" style={{ borderTopColor: PILLAR_ACCENTS.liderazgo, borderTopWidth: 3 }}>
        <div className="font-display text-[15px] font-bold mb-0.5" style={{ color: PILLAR_ACCENTS.liderazgo }}>
          Liderazgo de {targetName}
        </div>
        <div className="text-[11.5px] text-steel mb-3">{anonymousNote}</div>
        <div className="space-y-3">
          {data.questions.map((q) => (
            <div key={q.id} className="flex items-center justify-between gap-3 flex-wrap">
              <span className="text-[13px] flex-1 min-w-[220px]">{q.text}</span>
              <ScorePicker value={answers[q.id] ?? null} onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))} />
            </div>
          ))}
        </div>
      </div>

      <div className="bg-surface border border-rule rounded-md p-4.5 mb-3">
        <label className="block mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-steel">Algo excelente (obligatorio)</label>
        <textarea
          className="w-full rounded border border-rule px-2.5 py-2 text-[13px] bg-surface"
          rows={2}
          maxLength={600}
          placeholder={`Ej. ${targetName} siempre me da espacio para proponer soluciones…`}
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
          placeholder="Solo si sientes que hay algo que sumaría — no es obligatorio."
          value={improvementComment}
          onChange={(e) => setImprovementComment(e.target.value)}
        />
      </div>

      {err && <div className="text-red text-[12.5px] mb-3">{err}</div>}

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={!canSubmit || busy}
          className="inline-flex items-center gap-1.5 rounded border border-blue bg-blue px-4 py-2.5 text-[13px] font-semibold text-white cursor-pointer disabled:opacity-50"
          onClick={submit}
        >
          {busy ? "Guardando…" : "Guardar calificación"}
        </button>
        {!allAnswered && <span className="text-[12px] text-steel">Responde las 4 preguntas.</span>}
      </div>
    </div>
  );
}
