"use client";

import { useState, useEffect } from "react";
import { Check, Lock, FileText, Scale, Waypoints, LayoutGrid, Loader2, ChevronLeft, ChevronRight, Clock } from "lucide-react";

type StepDTO = {
  id: string;
  order: number;
  kind: "document" | "law" | "process" | "module";
  title: string;
  meta: string;
  estimatedMinutes: number;
  questionCount: number;
  status: "done" | "current" | "locked";
  correctCount: number | null;
};

type PathDTO = {
  id: string;
  title: string;
  description: string;
  totalEstimatedMinutes: number;
  assignedAt: string;
  dueAt: string;
  steps: StepDTO[];
};

type TakeableOption = { id: number; label: string };

type TakeableQuestion = {
  id: string;
  type: "MULTIPLE_CHOICE" | "TRUE_FALSE" | "MATCHING" | "SHORT_ANSWER";
  text: string;
  options: TakeableOption[];
  matchLeft: string[];
};

type SavedAnswer = { questionId: string; selectedIndex?: number; matchOrder?: number[]; textAnswer?: string };
type StepPayload = { stepId: string; kind: string; title: string; questions: TakeableQuestion[]; savedAnswers: SavedAnswer[] };

type Answer = { selectedIndex?: number; matchOrder?: number[]; textAnswer?: string };

function KindIcon({ kind }: { kind: StepDTO["kind"] }) {
  if (kind === "module") return <LayoutGrid size={15} />;
  if (kind === "law") return <Scale size={15} />;
  if (kind === "process") return <Waypoints size={15} />;
  return <FileText size={15} />;
}

function daysRemaining(dueAt: string): number {
  return Math.ceil((new Date(dueAt).getTime() - Date.now()) / 86400000);
}

export function MyLearningPaths({ initialPaths }: { initialPaths: PathDTO[] }) {
  const [paths, setPaths] = useState(initialPaths);
  const [takingStepId, setTakingStepId] = useState<string | null>(null);

  const refresh = async () => {
    const res = await fetch("/api/my-learning-paths");
    if (res.ok) setPaths(await res.json());
  };

  if (paths.length === 0) {
    return <div className="text-steel text-[13.5px]">No tienes ninguna ruta asignada por ahora.</div>;
  }

  if (takingStepId) {
    return (
      <StepQuiz
        stepId={takingStepId}
        onExit={() => setTakingStepId(null)}
        onFinished={async () => {
          setTakingStepId(null);
          await refresh();
        }}
      />
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {paths.map((path) => {
        const doneCount = path.steps.filter((s) => s.status === "done").length;
        const allDone = doneCount === path.steps.length;
        const pct = path.steps.length > 0 ? (doneCount / path.steps.length) * 100 : 0;
        const remaining = daysRemaining(path.dueAt);
        return (
          <div key={path.id} className="bg-surface border border-rule rounded-md p-5">
            <div className="text-[18px] font-bold mb-1">{path.title}</div>
            <div className="text-[12.5px] text-steel mb-1">
              {doneCount} de {path.steps.length} pasos completados · ⏱{" "}
              {Math.round((path.totalEstimatedMinutes / 60) * 10) / 10}h en total
            </div>
            {!allDone && (
              <div
                className={`inline-flex items-center gap-1.5 text-[11.5px] font-semibold rounded-full px-2.5 py-1 mb-3 ${
                  remaining <= 1 ? "bg-red/15 text-red" : remaining <= 2 ? "bg-gold/15 text-gold" : "bg-cloud text-steel"
                }`}
              >
                <Clock size={12} />
                {remaining > 0
                  ? `Te quedan ${remaining} día${remaining === 1 ? "" : "s"} laborable${remaining === 1 ? "" : "s"} para terminarla`
                  : "El plazo sugerido ya venció — sigue avanzando cuando puedas"}
              </div>
            )}
            <div className="h-1.5 rounded-full bg-cloud overflow-hidden mb-4">
              <div
                className="h-full rounded-full"
                style={{ width: `${pct}%`, background: "linear-gradient(90deg,#1E5EFF,#14C7C7)" }}
              />
            </div>

            {path.steps.map((step) => (
              <div
                key={step.id}
                className={`flex items-center gap-3 rounded-md border p-3 mb-2 ${
                  step.status === "current" ? "border-blue bg-blue/5" : "border-rule bg-cloud"
                } ${step.status === "done" ? "opacity-70" : ""}`}
              >
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                    step.status === "done"
                      ? "bg-teal text-navy"
                      : step.status === "current"
                        ? "bg-blue text-white"
                        : "bg-surface border border-rule text-steel"
                  }`}
                >
                  {step.status === "done" ? <Check size={16} /> : step.status === "locked" ? <Lock size={13} /> : <KindIcon kind={step.kind} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-[13.5px]">{step.title}</div>
                  <div className="text-[11.5px] text-steel">
                    {step.status === "done"
                      ? `Completado · ${step.correctCount ?? 0}/${step.questionCount} correctas`
                      : step.status === "current"
                        ? `${step.meta} · ⏱ ~${step.estimatedMinutes} min`
                        : "Se desbloquea al terminar el paso anterior"}
                  </div>
                </div>
                {step.status === "current" && (
                  <button
                    type="button"
                    className="px-3.5 py-1.5 rounded bg-blue text-white text-[12px] font-semibold cursor-pointer shrink-0"
                    onClick={() => setTakingStepId(step.id)}
                  >
                    Continuar
                  </button>
                )}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function StepQuiz({ stepId, onExit, onFinished }: { stepId: string; onExit: () => void; onFinished: () => void }) {
  const [data, setData] = useState<StepPayload | null>(null);
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [err, setErr] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ correctCount: number; total: number } | null>(null);

  useEffect(() => {
    fetch(`/api/my-learning-paths/steps/${stepId}`)
      .then(async (res) => {
        const json: StepPayload = await res.json();
        if (!res.ok) throw new Error((json as unknown as { error?: string })?.error ?? "No se pudo cargar el paso.");
        setData(json);

        const restored: Record<string, Answer> = {};
        for (const a of json.savedAnswers) {
          restored[a.questionId] = { selectedIndex: a.selectedIndex, matchOrder: a.matchOrder, textAnswer: a.textAnswer };
        }
        setAnswers(restored);
        const firstUnanswered = json.questions.findIndex((q) => !restored[q.id]);
        setIdx(firstUnanswered === -1 ? Math.max(0, json.questions.length - 1) : firstUnanswered);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "No se pudo cargar el paso."));
  }, [stepId]);

  if (err) {
    return (
      <div className="max-w-xl">
        <div className="text-red text-[13.5px] mb-3">{err}</div>
        <button type="button" className="text-blue text-[13px] font-semibold cursor-pointer" onClick={onExit}>
          ← Volver
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center gap-2 text-steel text-[13.5px]">
        <Loader2 size={16} className="animate-spin" /> Cargando…
      </div>
    );
  }

  if (result) {
    return (
      <div className="max-w-xl bg-surface border border-rule rounded-md p-6 text-center">
        <div className="text-[18px] font-bold mb-2">¡Paso completado!</div>
        <div className="text-[14px] text-steel mb-4">
          Respondiste correctamente {result.correctCount} de {result.total} preguntas.
        </div>
        <button type="button" className="px-4 py-2 rounded bg-blue text-white text-[13px] font-semibold cursor-pointer" onClick={onFinished}>
          Volver a mi ruta
        </button>
      </div>
    );
  }

  const q = data.questions[idx];
  const ans = answers[q.id] ?? {};
  const setAns = (a: Answer) => setAnswers((prev) => ({ ...prev, [q.id]: { ...prev[q.id], ...a } }));

  // Guarda de inmediato la respuesta de la pregunta actual — si la persona
  // tiene que salir a media ruta, ya quedó registrada y retoma justo aquí.
  const persist = (questionId: string, a: Answer) => {
    fetch(`/api/my-learning-paths/steps/${stepId}/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questionId, ...a }),
    }).catch(() => {});
  };

  const canAdvance =
    q.type === "SHORT_ANSWER"
      ? !!ans.textAnswer?.trim()
      : q.type === "MATCHING"
        ? Array.isArray(ans.matchOrder) && ans.matchOrder.length === q.matchLeft.length && ans.matchOrder.every((v) => v !== undefined)
        : typeof ans.selectedIndex === "number";

  const goTo = (nextIdx: number) => {
    if (ans && (ans.selectedIndex !== undefined || ans.matchOrder !== undefined || ans.textAnswer?.trim())) {
      persist(q.id, ans);
    }
    setIdx(nextIdx);
  };

  const submit = async () => {
    if (ans && (ans.selectedIndex !== undefined || ans.matchOrder !== undefined || ans.textAnswer?.trim())) {
      persist(q.id, ans);
    }
    setSubmitting(true);
    try {
      const payload = Object.entries(answers).map(([questionId, a]) => ({ questionId, ...a }));
      const res = await fetch(`/api/my-learning-paths/steps/${stepId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: payload }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "No se pudo guardar tus respuestas.");
      setResult(json);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo guardar tus respuestas.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-xl bg-surface border border-rule rounded-md p-6">
      <div className="text-[11px] font-bold uppercase tracking-wide text-steel mb-1">
        {data.title} · Pregunta {idx + 1} de {data.questions.length}
      </div>
      <div className="text-[15.5px] font-semibold mb-4">{q.text}</div>

      {(q.type === "MULTIPLE_CHOICE" || q.type === "TRUE_FALSE") && (
        <div className="space-y-2 mb-4">
          {q.options.map((opt) => (
            <div
              key={opt.id}
              onClick={() => {
                setAns({ selectedIndex: opt.id });
                persist(q.id, { selectedIndex: opt.id });
              }}
              className={`px-3.5 py-2.5 rounded-md border cursor-pointer text-[13.5px] ${
                ans.selectedIndex === opt.id ? "border-teal bg-teal/10" : "border-rule hover:border-blue"
              }`}
            >
              {opt.label}
            </div>
          ))}
        </div>
      )}

      {q.type === "MATCHING" && (
        <div className="space-y-2.5 mb-4">
          {q.matchLeft.map((left, i) => (
            <div key={i} className="flex items-center gap-2.5">
              <div className="flex-1 px-3 py-2 rounded border border-rule bg-cloud text-[13px]">{left}</div>
              <select
                value={ans.matchOrder?.[i] ?? ""}
                onChange={(e) => {
                  const next = [...(ans.matchOrder ?? Array(q.matchLeft.length).fill(undefined))];
                  next[i] = Number(e.target.value);
                  const nextMatch = next as number[];
                  setAns({ matchOrder: nextMatch });
                  if (nextMatch.every((v) => v !== undefined)) persist(q.id, { matchOrder: nextMatch });
                }}
                className="flex-1 px-3 py-2 rounded border border-rule bg-surface text-[13px]"
              >
                <option value="" disabled>
                  Elige…
                </option>
                {q.options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}

      {q.type === "SHORT_ANSWER" && (
        <textarea
          value={ans.textAnswer ?? ""}
          onChange={(e) => setAns({ textAnswer: e.target.value })}
          onBlur={() => ans.textAnswer?.trim() && persist(q.id, { textAnswer: ans.textAnswer })}
          placeholder="Escribe tu respuesta…"
          className="w-full min-h-[100px] px-3 py-2.5 rounded-md border border-rule bg-cloud text-[13.5px] mb-4"
        />
      )}

      <div className="flex items-center justify-between mt-2">
        <button
          type="button"
          disabled={idx === 0}
          onClick={() => goTo(idx - 1)}
          className="flex items-center gap-1 text-[13px] text-steel disabled:opacity-40 cursor-pointer"
        >
          <ChevronLeft size={15} /> Anterior
        </button>
        {idx < data.questions.length - 1 ? (
          <button
            type="button"
            disabled={!canAdvance}
            onClick={() => goTo(idx + 1)}
            className="flex items-center gap-1 px-4 py-2 rounded bg-blue text-white text-[13px] font-semibold cursor-pointer disabled:opacity-40"
          >
            Siguiente <ChevronRight size={15} />
          </button>
        ) : (
          <button
            type="button"
            disabled={!canAdvance || submitting}
            onClick={submit}
            className="px-4 py-2 rounded bg-blue text-white text-[13px] font-semibold cursor-pointer disabled:opacity-40"
          >
            {submitting ? "Guardando…" : "Finalizar"}
          </button>
        )}
      </div>
    </div>
  );
}
