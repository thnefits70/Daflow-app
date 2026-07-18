"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { User, CheckCircle2, Circle, ArrowLeft, Clock } from "lucide-react";
import { evaluationDeadline, formatDeadline, currentMonth, PILLAR_ACCENTS, type PillarKey } from "@/lib/recognition";

export type RecognitionPersonDTO = {
  id: string;
  name: string;
  photoUrl: string | null;
  position: string | null;
  deptName: string | null;
  // Every month this person already has an evaluation for — lets the "Evaluado
  // este mes" badge stay correct even when evaluating a past month (see the
  // month picker below), not just the current one.
  doneMonths: string[];
};

type QuestionDTO = { id: string; text: string; score: number | null };
type PillarDTO = { key: string; label: string; tagline: string; description: string; why: string; questions: QuestionDTO[] };
type EvaluationData = { month: string; pillars: PillarDTO[]; comment: string; questionsPerPillar: number };

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

export function RecognitionPanel({
  month,
  maxTotalScore,
  people,
  emptyMessage,
  allowMonthPicker = false,
}: {
  month: string;
  maxTotalScore: number;
  people: RecognitionPersonDTO[];
  emptyMessage: string;
  // Off by default (evaluates only the current month, as always). Turn on
  // temporarily when catching up a past month that this feature didn't
  // exist for yet — see the note next to the picker below.
  allowMonthPicker?: boolean;
}) {
  const router = useRouter();
  const [selectedMonth, setSelectedMonth] = useState(month);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [data, setData] = useState<EvaluationData | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);

  const selectedPerson = people.find((p) => p.id === selectedId) ?? null;

  useEffect(() => {
    if (!selectedId) return;
    setLoading(true);
    setErr("");
    setSaved(false);
    fetch(`/api/recognition/evaluation?evaluateeId=${selectedId}&month=${selectedMonth}`)
      .then((res) => res.json())
      .then((d: EvaluationData) => {
        setData(d);
        setComment(d.comment ?? "");
        const initial: Record<string, number> = {};
        for (const pillar of d.pillars) {
          for (const q of pillar.questions) {
            if (q.score !== null) initial[q.id] = q.score;
          }
        }
        setAnswers(initial);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, selectedMonth]);

  const totalQuestions = data ? data.pillars.reduce((a, p) => a + p.questions.length, 0) : 0;
  const answeredCount = Object.keys(answers).length;
  const allAnswered = data !== null && answeredCount === totalQuestions;

  const submit = async () => {
    if (!data || !selectedId || !allAnswered) return;
    setBusy(true);
    setErr("");
    const scores = data.pillars.flatMap((p) => p.questions.map((q) => ({ pillar: p.key, questionId: q.id, score: answers[q.id] })));
    const res = await fetch("/api/recognition/evaluation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ evaluateeId: selectedId, month: selectedMonth, scores, comment: comment.trim() }),
    });
    setBusy(false);
    if (!res.ok) {
      const errData = await res.json().catch(() => null);
      setErr(errData?.error ?? "No se pudo guardar la evaluación.");
      return;
    }
    setSaved(true);
    router.refresh();
  };

  if (selectedId && selectedPerson) {
    return (
      <div>
        {/* Stays pinned while scrolling through the 28 questions, so who
            you're evaluating is always visible. Bleeds horizontally out to
            the edges of <main>'s padding so it reads as a full-width bar —
            deliberately NOT bleeding vertically too: a negative top margin
            throws off sticky's own offset math (it's measured from the
            margin edge), so the bar would stick 36px below top:0 instead of
            flush against it. */}
        <div className="sticky top-0 z-10 bg-bg -mx-4 md:-mx-9 px-4 md:px-9 pt-3 pb-4 mb-2 border-b border-rule">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-[13px] text-steel hover:text-ink cursor-pointer mb-4"
            onClick={() => setSelectedId(null)}
          >
            <ArrowLeft size={14} /> Volver a la lista
          </button>

          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full overflow-hidden bg-cloud border border-rule flex items-center justify-center shrink-0">
              {selectedPerson.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={selectedPerson.photoUrl} alt={selectedPerson.name} className="w-full h-full object-cover" />
              ) : (
                <User size={20} className="text-steel" />
              )}
            </div>
            <div>
              <div className="font-display text-[18px] font-bold">{selectedPerson.name}</div>
              <div className="text-[12px] text-steel">{selectedPerson.position || selectedPerson.deptName || ""} · {selectedMonth}</div>
            </div>
          </div>
        </div>

        {loading && <div className="text-[13px] text-steel">Cargando preguntas…</div>}

        {data && !loading && (
          <div>
            {saved ? (
              <div className="bg-teal/10 border border-teal rounded-md p-5 text-center mb-5">
                <CheckCircle2 size={22} className="text-teal mx-auto mb-1.5" />
                <div className="font-semibold text-[14px]">Evaluación guardada</div>
                <div className="text-[12.5px] text-steel mt-0.5">
                  Puedes editarla en cualquier momento antes de que cierre el mes.
                </div>
                <button
                  type="button"
                  className="mt-3 text-[12.5px] font-semibold text-blue cursor-pointer"
                  onClick={() => setSelectedId(null)}
                >
                  Volver a la lista
                </button>
              </div>
            ) : (
              <>
                {data.pillars.map((pillar) => {
                  const accent = PILLAR_ACCENTS[pillar.key as PillarKey] ?? "#14C7C7";
                  return (
                    <div key={pillar.key} className="bg-surface border border-rule rounded-md p-4.5 mb-4" style={{ borderTopColor: accent, borderTopWidth: 3 }}>
                      <div className="mb-3">
                        <div className="font-display text-[15px] font-bold" style={{ color: accent }}>
                          {pillar.label}
                        </div>
                        <div className="text-[12.5px] italic text-ink mt-0.5">&ldquo;{pillar.tagline}&rdquo;</div>
                        <div className="text-[11.5px] text-steel mt-1">{pillar.description}</div>
                      </div>
                      <div className="space-y-3">
                        {pillar.questions.map((q) => (
                          <div key={q.id} className="flex items-center justify-between gap-3 flex-wrap">
                            <span className="text-[13px] flex-1 min-w-[220px]">{q.text}</span>
                            <ScorePicker value={answers[q.id] ?? null} onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))} />
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}

                <div className="bg-surface border border-rule rounded-md p-4.5 mb-5">
                  <label className="block mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-steel">
                    Comentario (opcional)
                  </label>
                  <div className="text-[11.5px] text-steel mb-2">
                    Un punto corto que destaque de esta persona este mes — algo bueno, o algo en lo que puede mejorar.
                  </div>
                  <textarea
                    className="w-full rounded border border-rule px-2.5 py-2 text-[13px] bg-surface"
                    rows={2}
                    maxLength={600}
                    placeholder="Ej. Excelente manejo de la presión en la última semana del mes…"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                  />
                </div>

                {err && <div className="text-red text-[12.5px] mb-3">{err}</div>}

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    disabled={!allAnswered || busy}
                    className="inline-flex items-center gap-1.5 rounded border border-blue bg-blue px-4 py-2.5 text-[13px] font-semibold text-white cursor-pointer disabled:opacity-50"
                    onClick={submit}
                  >
                    {busy ? "Guardando…" : "Guardar evaluación"}
                  </button>
                  <span className="text-[12px] text-steel">
                    {answeredCount} de {totalQuestions} preguntas respondidas
                  </span>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  const deadline = evaluationDeadline(selectedMonth);
  const overdue = new Date() > deadline;
  const isCurrentMonth = selectedMonth === currentMonth();
  const pendingCount = people.filter((p) => !p.doneMonths.includes(selectedMonth)).length;

  return (
    <div>
      {allowMonthPicker && (
        <div className="bg-surface border border-rule rounded-md p-3.5 mb-4 flex items-center gap-3 flex-wrap">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-steel">Evaluando el mes de</label>
          <input
            type="month"
            className="rounded border border-rule px-2.5 py-1.5 text-[13px] bg-surface"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
          />
          {!isCurrentMonth && (
            <span className="text-[11px] font-semibold" style={{ color: "#D9A441" }}>
              Cargando para un mes distinto al actual — úsalo solo para ponerte al día.
            </span>
          )}
        </div>
      )}
      {pendingCount > 0 && (
        <div className={`rounded-md p-3.5 mb-4 flex items-center gap-2.5 text-[12.5px] border ${overdue ? "bg-red/10 border-red text-red" : "bg-cloud border-rule text-steel"}`}>
          <Clock size={15} className="shrink-0" />
          {overdue
            ? `El plazo para evaluar ${isCurrentMonth ? "este mes" : "ese mes"} venció el ${formatDeadline(deadline)}${isCurrentMonth ? " — ponte al día cuanto antes." : "."}`
            : `Tienes hasta el ${formatDeadline(deadline)} para evaluar a todo tu equipo ${isCurrentMonth ? "este mes" : "ese mes"}.`}
        </div>
      )}
      {people.length === 0 && (
        <div className="border-[1.5px] border-dashed border-rule rounded-md p-8.5 text-center text-steel text-[13.5px]">
          {emptyMessage}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        {people.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setSelectedId(p.id)}
            className="bg-surface border border-rule rounded p-4 text-left hover:border-blue cursor-pointer"
          >
            <div className="flex items-center gap-2.5 mb-2">
              <div className="w-10 h-10 rounded-full overflow-hidden bg-cloud border border-rule flex items-center justify-center shrink-0">
                {p.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.photoUrl} alt={p.name} className="w-full h-full object-cover" />
                ) : (
                  <User size={16} className="text-steel" />
                )}
              </div>
              <div className="min-w-0">
                <div className="font-semibold text-[13px] truncate">{p.name}</div>
                <div className="text-[11px] text-steel truncate">{p.position || p.deptName || ""}</div>
              </div>
            </div>
            {(() => {
              const done = p.doneMonths.includes(selectedMonth);
              return (
                <div className={`inline-flex items-center gap-1 text-[11px] font-semibold ${done ? "text-teal" : "text-steel"}`}>
                  {done ? <CheckCircle2 size={12} /> : <Circle size={12} />}
                  {done ? "Evaluado ese mes" : "Pendiente ese mes"}
                </div>
              );
            })()}
          </button>
        ))}
      </div>
    </div>
  );
}
