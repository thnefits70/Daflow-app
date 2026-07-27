"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Plus,
  Trash2,
  FileText,
  Scale,
  Waypoints,
  LayoutGrid,
  Sparkles,
  Search,
  X,
  Loader2,
} from "lucide-react";

type PathSummary = { id: string; title: string; description: string; stepCount: number; assignmentCount: number };

type Question = {
  id: string;
  type: "MULTIPLE_CHOICE" | "TRUE_FALSE" | "MATCHING" | "SHORT_ANSWER";
  text: string;
  options: string[];
  matchLeft: string[];
  correctIndex: number | null;
};

type Step = {
  id: string;
  order: number;
  kind: "document" | "law" | "process" | "module";
  title: string;
  meta: string;
  setId: string;
  estimatedMinutes: number;
  sampleSize: number;
  questions: Question[];
};

type Assignment = { userId: string; name: string; position: string | null; department: string | null; dueAt: string };

type PathDetail = {
  id: string;
  title: string;
  description: string;
  totalEstimatedMinutes: number;
  steps: Step[];
  assignments: Assignment[];
};

type ContentOption = { kind: "document" | "law" | "process" | "module"; refId: string; title: string; meta: string; hasQuestionSet: boolean };

type UserOption = { id: string; name: string; position: string | null; department: { name: string } | null };

const QUESTION_TYPE_LABEL: Record<Question["type"], string> = {
  MULTIPLE_CHOICE: "Opción múltiple",
  TRUE_FALSE: "Verdadero/Falso",
  MATCHING: "Unir con líneas",
  SHORT_ANSWER: "Respuesta escrita",
};

function KindIcon({ kind }: { kind: Step["kind"] }) {
  if (kind === "module") return <LayoutGrid size={15} />;
  if (kind === "law") return <Scale size={15} />;
  if (kind === "process") return <Waypoints size={15} />;
  return <FileText size={15} />;
}

function kindBg(kind: Step["kind"]) {
  if (kind === "module") return "bg-red/15 text-red";
  if (kind === "law") return "bg-gold/15 text-gold";
  if (kind === "process") return "bg-teal/15 text-teal";
  return "bg-blue/15 text-blue";
}

async function jsonOrThrow(res: Response) {
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "Ocurrió un error.");
  return data;
}

export function LearningPathsAdmin({ initialPaths }: { initialPaths: PathSummary[] }) {
  const [paths, setPaths] = useState(initialPaths);
  const [selectedId, setSelectedId] = useState<string | null>(initialPaths[0]?.id ?? null);
  const [detail, setDetail] = useState<PathDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busyStep, setBusyStep] = useState(false);
  const [err, setErr] = useState("");
  const [newPathOpen, setNewPathOpen] = useState(false);
  const [newPathTitle, setNewPathTitle] = useState("");
  const [createErr, setCreateErr] = useState("");

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerResults, setPickerResults] = useState<ContentOption[]>([]);

  const [assignOpen, setAssignOpen] = useState(false);
  const [users, setUsers] = useState<UserOption[] | null>(null);
  const [userQuery, setUserQuery] = useState("");

  const [addQuestionForStep, setAddQuestionForStep] = useState<string | null>(null);

  const refreshPaths = useCallback(async () => {
    const res = await fetch("/api/learning-paths");
    setPaths(await jsonOrThrow(res).catch(() => []));
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    setLoadingDetail(true);
    setErr("");
    try {
      const res = await fetch(`/api/learning-paths/${id}`);
      setDetail(await jsonOrThrow(res));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo cargar la ruta.");
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
    else setDetail(null);
  }, [selectedId, loadDetail]);

  useEffect(() => {
    if (!pickerOpen) return;
    const t = setTimeout(async () => {
      const res = await fetch(`/api/learning-paths/content-options?q=${encodeURIComponent(pickerQuery)}`);
      setPickerResults(await jsonOrThrow(res).catch(() => []));
    }, 250);
    return () => clearTimeout(t);
  }, [pickerOpen, pickerQuery]);

  useEffect(() => {
    if (assignOpen && users === null) {
      fetch("/api/users")
        .then(jsonOrThrow)
        .then(setUsers)
        .catch(() => setUsers([]));
    }
  }, [assignOpen, users]);

  const createPath = async () => {
    if (!newPathTitle.trim()) return;
    setCreating(true);
    setCreateErr("");
    try {
      const res = await fetch("/api/learning-paths", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newPathTitle.trim() }),
      });
      const created = await jsonOrThrow(res);
      await refreshPaths();
      setSelectedId(created.id);
      setNewPathOpen(false);
      setNewPathTitle("");
    } catch (e) {
      setCreateErr(e instanceof Error ? e.message : "No se pudo crear la ruta.");
    } finally {
      setCreating(false);
    }
  };

  const deletePath = async (id: string) => {
    if (!confirm("¿Eliminar esta ruta? Esto no borra el contenido ni los bancos de preguntas, solo la ruta.")) return;
    await fetch(`/api/learning-paths/${id}`, { method: "DELETE" });
    if (selectedId === id) setSelectedId(null);
    await refreshPaths();
  };

  const addContent = async (opt: ContentOption) => {
    if (!selectedId) return;
    setBusyStep(true);
    setPickerOpen(false);
    setErr("");
    try {
      const res = await fetch(`/api/learning-paths/${selectedId}/steps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: opt.kind, refId: opt.refId }),
      });
      await jsonOrThrow(res);
      await loadDetail(selectedId);
      await refreshPaths();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo agregar el contenido.");
    } finally {
      setBusyStep(false);
    }
  };

  const removeStep = async (stepId: string, title: string) => {
    if (!selectedId) return;
    if (!confirm(`¿Quitar "${title}" de esta ruta? El contenido y sus preguntas no se borran, solo se quitan de aquí.`)) return;
    await fetch(`/api/learning-paths/${selectedId}/steps/${stepId}`, { method: "DELETE" });
    await loadDetail(selectedId);
    await refreshPaths();
  };

  const generateMore = async (setId: string) => {
    setBusyStep(true);
    setErr("");
    try {
      const res = await fetch(`/api/learning-paths/question-sets/${setId}/generate`, { method: "POST" });
      await jsonOrThrow(res);
      if (selectedId) await loadDetail(selectedId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudieron generar preguntas.");
    } finally {
      setBusyStep(false);
    }
  };

  const deleteQuestion = async (questionId: string) => {
    if (!confirm("¿Eliminar esta pregunta? Como el banco de preguntas es compartido, se quita de todas las rutas que usan este contenido.")) return;
    await fetch(`/api/learning-paths/questions/${questionId}`, { method: "DELETE" });
    if (selectedId) await loadDetail(selectedId);
  };

  const assign = async (userId: string) => {
    if (!selectedId) return;
    await fetch(`/api/learning-paths/${selectedId}/assignments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    await loadDetail(selectedId);
    await refreshPaths();
  };

  const unassign = async (userId: string, name: string) => {
    if (!selectedId) return;
    if (!confirm(`¿Quitarle esta ruta a ${name}? Perderá acceso y su progreso quedará guardado pero oculto.`)) return;
    await fetch(`/api/learning-paths/${selectedId}/assignments/${userId}`, { method: "DELETE" });
    await loadDetail(selectedId);
    await refreshPaths();
  };

  const totalHours = detail ? detail.totalEstimatedMinutes / 60 : 0;
  const gaugePct = Math.max(0, Math.min(100, ((totalHours - 2) / 6) * 100));
  const gaugeOk = totalHours >= 2 && totalHours <= 8;

  const filteredUsers = (users ?? []).filter(
    (u) =>
      !detail?.assignments.some((a) => a.userId === u.id) &&
      (userQuery.trim() === "" || u.name.toLowerCase().includes(userQuery.toLowerCase()))
  );

  return (
    <div className="grid grid-cols-1 md:grid-cols-[270px_1fr] gap-4">
      <div className="bg-surface border border-rule rounded-md p-2.5 h-fit">
        {paths.map((p) => (
          <div
            key={p.id}
            className={`group flex items-center gap-1.5 rounded px-2.5 py-2 mb-1 cursor-pointer text-[13px] font-semibold ${
              selectedId === p.id ? "bg-blue text-white" : "hover:bg-cloud"
            }`}
            onClick={() => setSelectedId(p.id)}
          >
            <div className="flex-1 min-w-0">
              <div className="truncate">{p.title}</div>
              <div className={`text-[11px] font-medium ${selectedId === p.id ? "text-white/80" : "text-steel"}`}>
                {p.stepCount} pasos · {p.assignmentCount} asignados
              </div>
            </div>
            <button
              type="button"
              className={`opacity-0 group-hover:opacity-100 p-1 rounded cursor-pointer ${
                selectedId === p.id ? "text-white/80 hover:text-white" : "text-steel hover:text-red"
              }`}
              onClick={(e) => {
                e.stopPropagation();
                deletePath(p.id);
              }}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        {newPathOpen ? (
          <div className="p-1">
            <input
              autoFocus
              value={newPathTitle}
              onChange={(e) => setNewPathTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createPath()}
              placeholder='Título (ej. "Encargada Servicio Postventa")'
              className="w-full px-2.5 py-2 rounded border border-rule bg-cloud text-[12.5px] mb-1.5"
            />
            {createErr && <div className="text-red text-[11.5px] mb-1.5">{createErr}</div>}
            <div className="flex gap-1.5">
              <button
                type="button"
                disabled={creating}
                onClick={createPath}
                className="flex-1 rounded bg-blue text-white text-[12px] font-semibold py-1.5 cursor-pointer disabled:opacity-60"
              >
                {creating ? "Creando…" : "Crear"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setNewPathOpen(false);
                  setNewPathTitle("");
                  setCreateErr("");
                }}
                className="px-2.5 rounded border border-rule text-steel text-[12px] cursor-pointer"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setNewPathOpen(true)}
            className="w-full flex items-center justify-center gap-1.5 rounded-md border-[1.5px] border-dashed border-rule text-steel hover:border-blue hover:text-blue text-[12.5px] font-semibold py-2.5 cursor-pointer"
          >
            <Plus size={14} /> Nueva ruta
          </button>
        )}
      </div>

      <div className="bg-surface border border-rule rounded-md p-5 min-h-[300px]">
        {!selectedId && <div className="text-steel text-[13.5px] text-center py-10">Selecciona o crea una ruta.</div>}

        {selectedId && loadingDetail && !detail && (
          <div className="text-steel text-[13.5px] text-center py-10 flex items-center justify-center gap-2">
            <Loader2 size={16} className="animate-spin" /> Cargando…
          </div>
        )}

        {selectedId && detail && (
          <div>
            <div className="text-[18px] font-bold mb-1">{detail.title}</div>
            {err && <div className="text-red text-[12.5px] mb-2">{err}</div>}

            <div className="flex items-center gap-3 rounded-md bg-cloud border border-rule px-3.5 py-2.5 mb-4 text-[12px]">
              <span className="text-steel whitespace-nowrap">
                ⏱ Tiempo estimado <b className="text-ink">{Math.round(totalHours * 10) / 10}h</b>
              </span>
              <div className="relative flex-1 h-1.5 rounded-full bg-surface">
                <div
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{ width: `${gaugePct}%`, background: gaugeOk ? "linear-gradient(90deg,#1E5EFF,#14C7C7)" : "#D9A441" }}
                />
              </div>
              <span className="text-steel/70 whitespace-nowrap">2h – 8h</span>
            </div>

            <div className="text-[11.5px] font-bold uppercase tracking-wide text-steel mb-2">Pasos de la ruta</div>

            {detail.steps.length === 0 && (
              <div className="border-[1.5px] border-dashed border-rule rounded-md p-6 text-center text-steel text-[13px] mb-3">
                Sin pasos todavía.
              </div>
            )}

            {detail.steps.map((step, idx) => (
              <div key={step.id} className="border border-rule rounded-md p-3 mb-2 bg-cloud">
                <div className="flex items-start gap-2.5">
                  <div className="w-6 h-6 rounded-full bg-surface border border-rule flex items-center justify-center text-[11px] font-bold text-steel shrink-0 mt-0.5">
                    {idx + 1}
                  </div>
                  <div className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${kindBg(step.kind)}`}>
                    <KindIcon kind={step.kind} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-[13.5px]">{step.title}</div>
                    <div className="text-[11.5px] text-steel">
                      {step.meta} · ⏱ ~{step.estimatedMinutes} min · banco de {step.questions.length}, muestra de{" "}
                      {Math.min(step.sampleSize, step.questions.length)} por persona
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-dashed border-rule">
                      {step.questions.map((q) => (
                        <span
                          key={q.id}
                          className="group/q inline-flex items-center gap-1 text-[10.5px] bg-surface border border-rule rounded px-2 py-1 text-steel"
                        >
                          {QUESTION_TYPE_LABEL[q.type]}
                          <button
                            type="button"
                            className="opacity-0 group-hover/q:opacity-100 text-red cursor-pointer"
                            onClick={() => deleteQuestion(q.id)}
                            title="Eliminar pregunta"
                          >
                            <X size={11} />
                          </button>
                        </span>
                      ))}
                      <button
                        type="button"
                        disabled={busyStep}
                        onClick={() => generateMore(step.setId)}
                        className="text-[10.5px] font-semibold border border-dashed border-teal text-teal rounded px-2 py-1 cursor-pointer disabled:opacity-50 flex items-center gap-1"
                      >
                        <Sparkles size={11} /> Generar más con IA
                      </button>
                      <button
                        type="button"
                        onClick={() => setAddQuestionForStep(addQuestionForStep === step.id ? null : step.id)}
                        className="text-[10.5px] font-semibold border border-dashed border-rule text-steel rounded px-2 py-1 cursor-pointer"
                      >
                        + manual
                      </button>
                    </div>
                    {addQuestionForStep === step.id && (
                      <ManualQuestionForm
                        setId={step.setId}
                        onDone={() => {
                          setAddQuestionForStep(null);
                          if (selectedId) loadDetail(selectedId);
                        }}
                      />
                    )}
                  </div>
                  <button
                    type="button"
                    className="p-1 text-steel hover:text-red cursor-pointer shrink-0"
                    onClick={() => removeStep(step.id, step.title)}
                    title="Quitar paso"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}

            <div className="relative">
              <button
                type="button"
                disabled={busyStep}
                onClick={() => setPickerOpen((v) => !v)}
                className="w-full flex items-center justify-center gap-1.5 rounded-md border-[1.5px] border-dashed border-rule text-blue text-[12.5px] font-semibold py-2.5 cursor-pointer disabled:opacity-60 mt-1"
              >
                {busyStep ? (
                  <>
                    <Loader2 size={14} className="animate-spin" /> Generando preguntas con IA…
                  </>
                ) : (
                  <>
                    <Plus size={14} /> Agregar contenido a la ruta
                  </>
                )}
              </button>

              {pickerOpen && (
                <div className="absolute z-10 mt-1 w-full bg-surface border border-rule rounded-md shadow-lg p-3">
                  <div className="relative mb-2">
                    <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-steel" />
                    <input
                      autoFocus
                      value={pickerQuery}
                      onChange={(e) => setPickerQuery(e.target.value)}
                      placeholder="Buscar módulo, ley, documento o proceso…"
                      className="w-full pl-7 pr-2.5 py-2 rounded border border-rule bg-cloud text-[12.5px]"
                    />
                  </div>
                  <div className="max-h-[220px] overflow-y-auto">
                    {pickerResults.length === 0 && <div className="text-steel text-[12px] px-1 py-2">Sin resultados.</div>}
                    {pickerResults.map((opt) => (
                      <div
                        key={`${opt.kind}-${opt.refId}`}
                        className="flex items-center gap-2 px-2 py-2 rounded hover:bg-cloud cursor-pointer text-[12.5px]"
                        onClick={() => addContent(opt)}
                      >
                        <div className={`w-5 h-5 rounded flex items-center justify-center shrink-0 ${kindBg(opt.kind)}`}>
                          <KindIcon kind={opt.kind} />
                        </div>
                        <span className="flex-1 truncate">{opt.title}</span>
                        <span className="text-[10.5px] text-steel shrink-0">{opt.meta}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="text-[11.5px] font-bold uppercase tracking-wide text-steel mt-5 mb-2">Asignar a</div>
            <div className="flex flex-wrap gap-2 items-center">
              {detail.assignments.map((a) => (
                <span key={a.userId} className="inline-flex items-center gap-1.5 rounded-full bg-cloud border border-rule pl-1 pr-2.5 py-1 text-[12px] font-semibold">
                  <span className="w-5.5 h-5.5 rounded-full bg-blue text-white text-[10px] font-bold flex items-center justify-center">
                    {a.name.slice(0, 2).toUpperCase()}
                  </span>
                  {a.name}
                  <span className="text-steel font-medium text-[10.5px]">
                    {a.position ?? "Sin puesto"}
                    {a.department ? ` · ${a.department}` : ""}
                    {` · vence ${new Date(a.dueAt).toLocaleDateString("es-EC", { day: "2-digit", month: "short" })}`}
                  </span>
                  <button type="button" className="text-steel hover:text-red cursor-pointer" onClick={() => unassign(a.userId, a.name)}>
                    <X size={12} />
                  </button>
                </span>
              ))}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setAssignOpen((v) => !v)}
                  className="inline-flex items-center gap-1.5 rounded-full border-[1.5px] border-dashed border-rule text-steel hover:border-blue hover:text-blue text-[12px] font-semibold pl-2.5 pr-3 py-1 cursor-pointer"
                >
                  <Plus size={13} /> Asignar colaborador
                </button>
                {assignOpen && (
                  <div className="absolute z-10 mt-1 w-64 bg-surface border border-rule rounded-md shadow-lg p-2.5">
                    <input
                      autoFocus
                      value={userQuery}
                      onChange={(e) => setUserQuery(e.target.value)}
                      placeholder="Buscar por nombre…"
                      className="w-full px-2.5 py-1.5 rounded border border-rule bg-cloud text-[12.5px] mb-1.5"
                    />
                    <div className="max-h-[200px] overflow-y-auto">
                      {filteredUsers.map((u) => (
                        <div
                          key={u.id}
                          className="px-2 py-1.5 rounded hover:bg-cloud cursor-pointer text-[12.5px]"
                          onClick={() => {
                            assign(u.id);
                            setAssignOpen(false);
                            setUserQuery("");
                          }}
                        >
                          <div className="font-semibold">{u.name}</div>
                          <div className="text-[10.5px] text-steel">
                            {u.position ?? "Sin puesto"} {u.department ? `· ${u.department.name}` : ""}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-dashed border-rule text-[11.5px] text-steel">
              La ruta se asigna directamente a la persona, no al puesto de Nómina — puedes armar rutas por
              responsabilidad real aunque no coincidan con el cargo formal.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ManualQuestionForm({ setId, onDone }: { setId: string; onDone: () => void }) {
  const [type, setType] = useState<Question["type"]>("MULTIPLE_CHOICE");
  const [text, setText] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [matchLeft, setMatchLeft] = useState(["", ""]);
  const [correctIndex, setCorrectIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const save = async () => {
    if (!text.trim()) return;
    setBusy(true);
    const payload =
      type === "TRUE_FALSE"
        ? { type, text, options: ["Verdadero", "Falso"], matchLeft: [], correctIndex }
        : type === "MATCHING"
          ? { type, text, options, matchLeft, correctIndex: null }
          : type === "SHORT_ANSWER"
            ? { type, text, options: [], matchLeft: [], correctIndex: null }
            : { type, text, options, matchLeft: [], correctIndex };
    await fetch(`/api/learning-paths/question-sets/${setId}/questions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => null);
    setBusy(false);
    onDone();
  };

  return (
    <div ref={ref} className="mt-2 p-2.5 rounded border border-rule bg-surface">
      <select
        value={type}
        onChange={(e) => setType(e.target.value as Question["type"])}
        className="bg-surface border border-rule rounded px-2 py-1.5 text-[12px] mb-2"
      >
        <option value="MULTIPLE_CHOICE">Opción múltiple</option>
        <option value="TRUE_FALSE">Verdadero/Falso</option>
        <option value="MATCHING">Unir con líneas</option>
        <option value="SHORT_ANSWER">Respuesta escrita</option>
      </select>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Texto de la pregunta"
        className="w-full bg-surface border border-rule rounded px-2.5 py-1.5 text-[12.5px] mb-2"
      />

      {type === "MULTIPLE_CHOICE" &&
        options.map((o, i) => (
          <div key={i} className="flex items-center gap-1.5 mb-1">
            <input type="radio" checked={correctIndex === i} onChange={() => setCorrectIndex(i)} />
            <input
              value={o}
              onChange={(e) => setOptions(options.map((v, j) => (j === i ? e.target.value : v)))}
              placeholder={`Alternativa ${i + 1}`}
              className="flex-1 bg-surface border border-rule rounded px-2 py-1 text-[12px]"
            />
          </div>
        ))}
      {type === "MULTIPLE_CHOICE" && (
        <button type="button" className="text-[11px] text-blue font-semibold cursor-pointer" onClick={() => setOptions([...options, ""])}>
          + alternativa
        </button>
      )}

      {type === "TRUE_FALSE" && (
        <div className="flex gap-3 mb-2 text-[12px]">
          <label className="flex items-center gap-1"><input type="radio" checked={correctIndex === 0} onChange={() => setCorrectIndex(0)} /> Verdadero</label>
          <label className="flex items-center gap-1"><input type="radio" checked={correctIndex === 1} onChange={() => setCorrectIndex(1)} /> Falso</label>
        </div>
      )}

      {type === "MATCHING" &&
        matchLeft.map((l, i) => (
          <div key={i} className="flex items-center gap-1.5 mb-1">
            <input
              value={l}
              onChange={(e) => setMatchLeft(matchLeft.map((v, j) => (j === i ? e.target.value : v)))}
              placeholder={`Izquierda ${i + 1}`}
              className="flex-1 bg-surface border border-rule rounded px-2 py-1 text-[12px]"
            />
            <input
              value={options[i] ?? ""}
              onChange={(e) => setOptions(options.map((v, j) => (j === i ? e.target.value : v)))}
              placeholder={`Derecha ${i + 1}`}
              className="flex-1 bg-surface border border-rule rounded px-2 py-1 text-[12px]"
            />
          </div>
        ))}
      {type === "MATCHING" && (
        <button
          type="button"
          className="text-[11px] text-blue font-semibold cursor-pointer"
          onClick={() => {
            setMatchLeft([...matchLeft, ""]);
            setOptions([...options, ""]);
          }}
        >
          + par
        </button>
      )}

      <div className="flex justify-end gap-2 mt-2">
        <button type="button" className="text-[12px] text-steel cursor-pointer" onClick={onDone}>Cancelar</button>
        <button
          type="button"
          disabled={busy}
          onClick={save}
          className="text-[12px] font-semibold text-white bg-blue rounded px-3 py-1.5 cursor-pointer disabled:opacity-60"
        >
          Guardar
        </button>
      </div>
    </div>
  );
}
