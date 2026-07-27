"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Pencil, GraduationCap } from "lucide-react";
import { ExamEditor, ExamTaker } from "@/components/exams/ExamsPanel";

type ExamSummary = { id: string; title: string; questionCount: number };

export function ModuleExamPanel({
  moduleId,
  exam,
  editable,
}: {
  moduleId: string;
  exam: ExamSummary | null;
  editable: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"list" | "edit" | "take">("list");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const create = async () => {
    setBusy(true);
    setErr("");
    const res = await fetch("/api/exams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ moduleId, title: "Examen del módulo" }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setErr(data?.error ?? "No se pudo crear el examen.");
      return;
    }
    router.refresh();
    setMode("edit");
  };

  const remove = async () => {
    if (!exam) return;
    if (!confirm("¿Eliminar este examen? Se perderán todas sus preguntas y calificaciones registradas.")) return;
    setBusy(true);
    await fetch(`/api/exams/${exam.id}`, { method: "DELETE" });
    setBusy(false);
    router.refresh();
  };

  if (mode === "edit" && exam) return <ExamEditor examId={exam.id} onBack={() => { router.refresh(); setMode("list"); }} />;
  if (mode === "take" && exam)
    return (
      <ExamTaker
        examId={exam.id}
        onBack={() => setMode("list")}
        onFinish={() => {
          router.refresh();
          setMode("list");
        }}
      />
    );

  return (
    <div>
      <div className="text-[13px] text-steel mb-4">
        Examen opcional para verificar que el equipo entendió el contenido de este módulo.
      </div>

      {!exam ? (
        editable ? (
          <button
            type="button"
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded border border-blue bg-blue px-3.5 py-2 text-[12.5px] font-semibold text-white cursor-pointer disabled:opacity-60"
            onClick={create}
          >
            <Plus size={14} /> Crear examen
          </button>
        ) : (
          <div className="border-[1.5px] border-dashed border-rule rounded-md p-8.5 text-center text-steel text-[13.5px]">
            Este módulo todavía no tiene examen.
          </div>
        )
      ) : (
        <div className="bg-surface border border-rule rounded p-4 flex items-center justify-between">
          <div>
            <div className="font-semibold text-[14.5px] flex items-center gap-1.5">
              <GraduationCap size={14} /> {exam.title}
            </div>
            <div className="text-[12.5px] text-steel mt-0.5">{exam.questionCount} preguntas</div>
          </div>
          <div className="flex items-center gap-2">
            {!editable && exam.questionCount > 0 && (
              <button
                type="button"
                className="rounded border border-blue bg-blue px-3.5 py-1.5 text-[12.5px] font-semibold text-white cursor-pointer"
                onClick={() => setMode("take")}
              >
                Rendir examen
              </button>
            )}
            {editable && (
              <>
                <button type="button" className="text-steel hover:text-ink cursor-pointer" onClick={() => setMode("edit")}>
                  <Pencil size={15} />
                </button>
                <button type="button" disabled={busy} className="text-steel hover:text-red cursor-pointer" onClick={remove}>
                  <Trash2 size={15} />
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {err && <div className="text-red text-[12.5px] mt-2">{err}</div>}
    </div>
  );
}
