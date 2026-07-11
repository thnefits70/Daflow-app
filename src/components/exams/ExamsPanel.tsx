"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Pencil, ArrowLeft, GraduationCap } from "lucide-react";

type ExamSummary = { id: string; title: string; questionCount: number };
type Question = { id: string; text: string; options: string[]; correctIndex: number };
type ExamDetail = { id: string; title: string; questions: Question[] };

function pct(a: number, b: number) {
  return b === 0 ? 0 : Math.round((a / b) * 100);
}

function ExamEditor({ examId, onBack }: { examId: string; onBack: () => void }) {
  const router = useRouter();
  const [draft, setDraft] = useState<ExamDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/exams/${examId}`)
      .then((r) => r.json())
      .then((data) => {
        setDraft({
          id: data.id,
          title: data.title,
          questions: data.questions.map((q: Question) => ({
            id: q.id,
            text: q.text,
            options: q.options,
            correctIndex: q.correctIndex,
          })),
        });
        setLoading(false);
      });
  }, [examId]);

  if (loading || !draft) return <div className="text-steel text-[13px]">Cargando…</div>;

  const addQ = () =>
    setDraft({
      ...draft,
      questions: [
        ...draft.questions,
        { id: crypto.randomUUID(), text: "Nueva pregunta", options: ["Opción 1", "Opción 2", "Opción 3"], correctIndex: 0 },
      ],
    });
  const rmQ = (id: string) => setDraft({ ...draft, questions: draft.questions.filter((q) => q.id !== id) });
  const updQ = (id: string, patch: Partial<Question>) =>
    setDraft({ ...draft, questions: draft.questions.map((q) => (q.id === id ? { ...q, ...patch } : q)) });

  const save = async () => {
    setSaving(true);
    await fetch(`/api/exams/${examId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: draft.title,
        questions: draft.questions.map((q) => ({ text: q.text, options: q.options, correctIndex: q.correctIndex })),
      }),
    });
    setSaving(false);
    router.refresh();
    onBack();
  };

  return (
    <div>
      <button type="button" className="inline-flex items-center gap-1.5 text-[13px] text-steel hover:text-navy mb-4.5 cursor-pointer" onClick={onBack}>
        <ArrowLeft size={14} /> Volver
      </button>
      <div className="mb-4">
        <label className="block mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">Título del examen</label>
        <input className="w-full rounded border border-rule px-2.5 py-2 text-[14px]" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
      </div>

      {draft.questions.map((q, i) => (
        <div key={q.id} className="bg-white border border-rule rounded p-4 mb-3">
          <div className="flex items-center justify-between mb-2">
            <span className="font-mono text-[11px] text-steel">PREGUNTA {i + 1}</span>
            <button type="button" className="text-steel hover:text-red cursor-pointer" onClick={() => rmQ(q.id)}>
              <Trash2 size={14} />
            </button>
          </div>
          <input
            className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px] mb-2.5"
            value={q.text}
            onChange={(e) => updQ(q.id, { text: e.target.value })}
          />
          {q.options.map((op, oi) => (
            <div key={oi} className="flex items-center gap-2 mb-1.5">
              <input type="radio" checked={q.correctIndex === oi} onChange={() => updQ(q.id, { correctIndex: oi })} />
              <input
                className="flex-1 rounded border border-rule px-2 py-1.5 text-[13px]"
                value={op}
                onChange={(e) => updQ(q.id, { options: q.options.map((o, k) => (k === oi ? e.target.value : o)) })}
              />
            </div>
          ))}
          <div className="text-[11px] text-steel mt-1">Marca con el punto la opción correcta.</div>
        </div>
      ))}

      <div className="flex items-center gap-2.5">
        <button type="button" className="border border-rule rounded px-3.5 py-2 text-[12.5px] font-semibold cursor-pointer inline-flex items-center gap-1.5" onClick={addQ}>
          <Plus size={13} /> Añadir pregunta
        </button>
        <button type="button" disabled={saving} className="rounded border border-navy bg-navy px-4 py-2 text-[13px] font-semibold text-white cursor-pointer disabled:opacity-60" onClick={save}>
          {saving ? "Guardando…" : "Guardar examen"}
        </button>
      </div>
    </div>
  );
}

function ExamTaker({ examId, onFinish, onBack }: { examId: string; onFinish: () => void; onBack: () => void }) {
  const [exam, setExam] = useState<{ id: string; title: string; questions: { id: string; text: string; options: string[] }[] } | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<{ score: number; total: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/exams/${examId}/take`)
      .then((r) => r.json())
      .then((data) => {
        setExam(data);
        setLoading(false);
      });
  }, [examId]);

  if (loading || !exam) return <div className="text-steel text-[13px]">Cargando…</div>;

  const submit = async () => {
    const res = await fetch(`/api/exams/${examId}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers }),
    });
    const data = await res.json();
    setResult({ score: data.score, total: data.total });
  };

  return (
    <div>
      <button type="button" className="inline-flex items-center gap-1.5 text-[13px] text-steel hover:text-navy mb-4.5 cursor-pointer" onClick={onBack}>
        <ArrowLeft size={14} /> Volver
      </button>
      <h2 className="font-display text-[18px] font-bold mb-4">{exam.title}</h2>

      {exam.questions.map((q, i) => (
        <div key={q.id} className="bg-white border border-rule rounded p-4 mb-3">
          <div className="font-semibold text-[14px] mb-2.5">{i + 1}. {q.text}</div>
          {q.options.map((op, oi) => (
            <div
              key={oi}
              className={`flex items-center gap-2.5 px-2.5 py-2 border rounded mb-1.5 cursor-pointer text-[13.5px] ${
                answers[q.id] === oi ? "border-blue bg-blue/10" : "border-rule"
              }`}
              onClick={() => !result && setAnswers({ ...answers, [q.id]: oi })}
            >
              {op}
            </div>
          ))}
        </div>
      ))}

      {!result ? (
        <button type="button" className="rounded border border-navy bg-navy px-5 py-2.5 text-[13px] font-semibold text-white cursor-pointer" onClick={submit}>
          Enviar examen
        </button>
      ) : (
        <div className="bg-white border border-rule rounded p-4">
          <div className="font-bold text-[16px] mb-2.5">
            Resultado: {result.score} / {result.total} ({pct(result.score, result.total)}%)
          </div>
          <button type="button" className="rounded border border-navy bg-navy px-4 py-2 text-[13px] font-semibold text-white cursor-pointer" onClick={onFinish}>
            Guardar y volver
          </button>
        </div>
      )}
    </div>
  );
}

export function ExamsPanel({ deptId, exams, editable }: { deptId: string; exams: ExamSummary[]; editable: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<{ type: "list" } | { type: "edit"; id: string } | { type: "take"; id: string }>({ type: "list" });
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    const res = await fetch("/api/exams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deptId, title: "Nuevo examen" }),
    });
    setBusy(false);
    if (!res.ok) return;
    const created = await res.json();
    router.refresh();
    setMode({ type: "edit", id: created.id });
  };

  const remove = async (id: string) => {
    setBusy(true);
    await fetch(`/api/exams/${id}`, { method: "DELETE" });
    setBusy(false);
    router.refresh();
  };

  if (mode.type === "edit") return <ExamEditor examId={mode.id} onBack={() => setMode({ type: "list" })} />;
  if (mode.type === "take")
    return (
      <ExamTaker
        examId={mode.id}
        onBack={() => setMode({ type: "list" })}
        onFinish={() => {
          router.refresh();
          setMode({ type: "list" });
        }}
      />
    );

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="text-[13px] text-steel">Evalúa qué tan bien conoce el equipo los procesos del área.</div>
        {editable && (
          <button
            type="button"
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded border border-navy bg-navy px-3.5 py-2 text-[12.5px] font-semibold text-white cursor-pointer disabled:opacity-60"
            onClick={create}
          >
            <Plus size={14} /> Nuevo examen
          </button>
        )}
      </div>

      {exams.length === 0 && (
        <div className="border-[1.5px] border-dashed border-rule rounded-md p-8.5 text-center text-steel text-[13.5px]">
          Aún no hay exámenes en esta área.
        </div>
      )}

      {exams.map((e) => (
        <div key={e.id} className="bg-white border border-rule rounded p-4 mb-2.5 flex items-center justify-between">
          <div>
            <div className="font-semibold text-[14.5px] flex items-center gap-1.5"><GraduationCap size={14} /> {e.title}</div>
            <div className="text-[12.5px] text-steel mt-0.5">{e.questionCount} preguntas</div>
          </div>
          <div className="flex items-center gap-2">
            {!editable && e.questionCount > 0 && (
              <button type="button" className="rounded border border-navy bg-navy px-3.5 py-1.5 text-[12.5px] font-semibold text-white cursor-pointer" onClick={() => setMode({ type: "take", id: e.id })}>
                Rendir examen
              </button>
            )}
            {editable && (
              <>
                <button type="button" className="text-steel hover:text-navy cursor-pointer" onClick={() => setMode({ type: "edit", id: e.id })}>
                  <Pencil size={15} />
                </button>
                <button type="button" className="text-steel hover:text-red cursor-pointer" onClick={() => remove(e.id)}>
                  <Trash2 size={15} />
                </button>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
