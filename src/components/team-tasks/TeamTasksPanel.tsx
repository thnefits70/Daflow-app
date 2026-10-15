"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Paperclip, ChevronDown, ChevronUp } from "lucide-react";
import { TabGuide } from "@/components/shared/TabGuide";
import { ProofPreview } from "@/components/shared/ProofPreview";
import { compressImage } from "@/lib/compressImage";
import { uploadFile } from "@/lib/uploadFile";
import type { TeamTaskAssignmentDTO, TeamTaskDTO, TeamTaskRole } from "@/lib/teamTasks";
import { useRememberedState } from "@/lib/rememberedState";

// Tareas del equipo — pedido de Bryan Ríos 2026-10-13. Una sola pestaña con
// tres vistas según quién mira: el líder asigna y revisa, el colaborador ve
// y avanza las suyas, el admin solo consulta.

type Status = TeamTaskAssignmentDTO["status"];

const STATUS_META: Record<Status, { label: string; color: string }> = {
  POR_HACER: { label: "Por hacer", color: "var(--color-steel)" },
  EN_PROCESO: { label: "En proceso", color: "var(--color-blue)" },
  HECHA: { label: "Hecha · por revisar", color: "var(--color-amber)" },
  DEVUELTA: { label: "Devuelta", color: "var(--color-red)" },
  APROBADA: { label: "Aprobada", color: "var(--color-green)" },
  CANCELADA: { label: "Cancelada", color: "var(--color-steel)" },
};

const EVENT_LABEL: Record<string, string> = {
  CREADA: "Asignada",
  EMPEZADA: "Empezó",
  HECHA: "Marcó como hecha",
  DEVUELTA: "Devuelta",
  APROBADA: "Aprobada",
  CANCELADA: "Cancelada",
};

type Filter = "revisar" | "abiertas" | "cerradas" | "todas";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "revisar", label: "Por revisar" },
  { key: "abiertas", label: "Abiertas" },
  { key: "cerradas", label: "Cerradas" },
  { key: "todas", label: "Todas" },
];
const OPEN: Status[] = ["POR_HACER", "EN_PROCESO", "DEVUELTA"];

function matchesFilter(s: Status, f: Filter) {
  if (f === "revisar") return s === "HECHA";
  if (f === "abiertas") return OPEN.includes(s) || s === "HECHA";
  if (f === "cerradas") return s === "APROBADA" || s === "CANCELADA";
  return true;
}

function formatDay(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("es-EC", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}
function formatStamp(iso: string) {
  return new Date(iso).toLocaleString("es-EC", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Guayaquil" });
}
function todayEc() {
  return new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);
}

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "Ocurrió un error.");
  return data;
}

async function uploadTaskFile(file: File) {
  const prepared = file.type === "application/pdf" ? file : await compressImage(file);
  const up = await uploadFile(prepared, "team-task-files");
  if (!up.ok) throw new Error(up.error);
  return up;
}

function StatusChip({ status, overdue }: { status: Status; overdue: boolean }) {
  const meta = STATUS_META[status];
  const color = overdue ? "var(--color-red)" : meta.color;
  return (
    <span
      className="font-mono text-[10.5px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap"
      style={{ color, border: `1px solid ${color}`, background: `color-mix(in srgb, ${color} 10%, transparent)` }}
    >
      {overdue ? "Vencida" : meta.label}
    </span>
  );
}

export function TeamTasksPanel({ deptId }: { deptId: string }) {
  const [data, setData] = useState<{ role: TeamTaskRole; tasks: TeamTaskDTO[]; members: { id: string; name: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useRememberedState<Filter>("tasks-filter", "abiertas");
  const [person, setPerson] = useState<string>("");

  function load() {
    fetch(`/api/team-tasks?deptId=${deptId}`)
      .then(async (res) => {
        const d = await res.json().catch(() => null);
        if (!res.ok) {
          setError(d?.error ?? "No se pudieron cargar las tareas.");
          return;
        }
        setError(null);
        setData(d);
      })
      .catch(() => setError("No se pudieron cargar las tareas."));
  }
  useEffect(load, [deptId]);

  const role = data?.role;
  const people = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of data?.tasks ?? []) for (const a of t.assignments) m.set(a.assigneeId, a.assigneeName);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [data]);

  const visible = useMemo(() => {
    const list = (data?.tasks ?? [])
      .map((t) => ({ ...t, assignments: t.assignments.filter((a) => matchesFilter(a.status, filter) && (!person || a.assigneeId === person)) }))
      .filter((t) => t.assignments.length > 0);
    // Lo vencido y lo que vence antes, arriba.
    const rank = (t: TeamTaskDTO) => (t.assignments.some((a) => a.overdue) ? 0 : t.assignments.some((a) => a.status === "HECHA") ? 1 : 2);
    return list.sort((a, b) => rank(a) - rank(b) || a.dueDate.localeCompare(b.dueDate));
  }, [data, filter, person]);

  const toReviewCount = (data?.tasks ?? []).reduce((n, t) => n + t.assignments.filter((a) => a.status === "HECHA").length, 0);

  if (creating && role === "leader") {
    return (
      <CreateTaskForm
        members={data?.members ?? []}
        onCancel={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          setFilter("abiertas");
          load();
        }}
      />
    );
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
        <h1 className="font-display text-[22px] font-bold">{role === "member" ? "Mis tareas" : "Tareas del equipo"}</h1>
        {role === "leader" && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 text-[13px] font-semibold text-white bg-blue px-3.5 py-2 rounded-md cursor-pointer"
          >
            <Plus size={14} /> Nueva tarea
          </button>
        )}
      </div>
      <p className="text-[13px] text-steel mb-3">
        {role === "member"
          ? "Lo que tu líder te asignó. Márcala como hecha y cuenta qué hiciste; tu líder la revisa."
          : role === "leader"
            ? "Asigna tareas a una o varias personas de tu área y revisa lo que ya terminaron."
            : "Vista de consulta: solo el líder del área asigna y revisa."}
      </p>
      <div className="mb-4">
        <TabGuide storageKey={`team-tasks-${role ?? "x"}`}>
          {role === "member" ? (
            <>
              1. Pulsa <b>Empezar</b> cuando te pongas con la tarea. 2. Al terminar pulsa <b>Marcar como hecha</b>, escribe qué hiciste y, si
              aplica, sube una foto. 3. Tu líder la aprueba o te la devuelve con un comentario; si te la devuelve, corrige y vuelve a
              marcarla como hecha. Cada mañana te llega un aviso con lo que tienes pendiente.
            </>
          ) : (
            <>
              1. <b>Nueva tarea</b>: escribe qué hay que hacer, la fecha límite y elige a una o varias personas (cada una la avanza por su
              lado). 2. Cuando alguien la marca como hecha te llega un aviso y aparece en <b>Por revisar</b>: lee su comentario y pulsa{" "}
              <b>Aprobar</b> o <b>Devolver</b> con lo que falta. 3. Si a alguien se le pasa la fecha, la tarea se pone en rojo y te avisamos.
            </>
          )}
        </TabGuide>
      </div>

      {error && <div className="text-[13px] text-red mb-3">{error}</div>}
      {!data && !error && <div className="text-[13px] text-steel">Cargando…</div>}

      {data && (
        <div className="flex items-center gap-2 flex-wrap mb-4">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`text-[12px] font-semibold px-3 py-1.5 rounded-full border cursor-pointer ${
                filter === f.key ? "border-teal text-ink bg-teal/10" : "border-rule text-steel hover:text-ink"
              }`}
            >
              {f.label}
              {f.key === "revisar" && toReviewCount > 0 && <span className="ml-1.5 font-mono text-red">{toReviewCount}</span>}
            </button>
          ))}
          {role !== "member" && people.length > 0 && (
            <select value={person} onChange={(e) => setPerson(e.target.value)} className="bg-cloud border border-rule rounded-md px-2 py-1.5 text-[12px] text-ink">
              <option value="">Todas las personas</option>
              {people.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {data && visible.length === 0 && (
        <div className="border-[1.5px] border-dashed border-rule rounded-md p-8.5 text-center text-steel text-[13.5px]">
          {filter === "revisar" ? "No hay tareas terminadas esperando revisión." : "No hay tareas aquí."}
        </div>
      )}

      <div className="space-y-3">
        {visible.map((t) => (
          <TaskCard key={t.id} task={t} role={role!} onChanged={load} />
        ))}
      </div>
    </div>
  );
}

function TaskCard({ task, role, onChanged }: { task: TeamTaskDTO; role: TeamTaskRole; onChanged: () => void }) {
  const overdue = task.assignments.some((a) => a.overdue);
  return (
    <div className={`bg-surface border rounded-lg p-4 ${overdue ? "border-red" : "border-rule"}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-ink break-words">
            {task.urgent && <span className="text-red mr-1.5">● Urgente</span>}
            {task.title}
          </div>
          <div className={`text-[12px] mt-0.5 ${overdue ? "text-red font-semibold" : "text-steel"}`}>
            Para el {formatDay(task.dueDate)}
            {task.createdByName && <span className="text-steel font-normal"> · asignada por {task.createdByName}</span>}
            <span className="text-steel font-normal"> · {formatStamp(task.createdAt)}</span>
          </div>
        </div>
        {role === "member" && task.assignments[0] && <StatusChip status={task.assignments[0].status} overdue={task.assignments[0].overdue} />}
      </div>

      {task.description && <p className="text-[13px] text-ink mt-2 whitespace-pre-wrap break-words">{task.description}</p>}
      {task.attachmentUrl && (
        <div className="mt-2 flex items-center gap-2">
          <ProofPreview url={task.attachmentUrl} filename={task.attachmentName ?? undefined} size={48} />
          <span className="text-[12px] text-steel flex items-center gap-1">
            <Paperclip size={12} /> {task.attachmentName ?? "Adjunto"}
          </span>
        </div>
      )}

      <div className="mt-3 space-y-2">
        {task.assignments.map((a) => (
          <AssignmentRow key={a.id} a={a} role={role} onChanged={onChanged} />
        ))}
      </div>
    </div>
  );
}

function AssignmentRow({ a, role, onChanged }: { a: TeamTaskAssignmentDTO; role: TeamTaskRole; onChanged: () => void }) {
  const [mode, setMode] = useState<null | "done" | "return">(null);
  const [comment, setComment] = useState("");
  const [photo, setPhoto] = useState<{ url: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await postJson(`/api/team-tasks/assignments/${a.id}`, body);
      setMode(null);
      setComment("");
      setPhoto(null);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  };

  const onPhoto = async (file: File) => {
    setUploading(true);
    setErr(null);
    try {
      const up = await uploadTaskFile(file);
      setPhoto({ url: up.url, name: up.name });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo subir la foto.");
    } finally {
      setUploading(false);
    }
  };

  const isOpen = OPEN.includes(a.status);

  return (
    <div className="border border-rule rounded-md p-3 bg-cloud/40">
      {role !== "member" && (
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="text-[13px] font-semibold text-ink">{a.assigneeName}</div>
          <StatusChip status={a.status} overdue={a.overdue} />
        </div>
      )}

      {a.status === "DEVUELTA" && a.returnComment && (
        <div className="text-[12.5px] text-red mt-1.5 whitespace-pre-wrap break-words">
          ↩️ {role === "member" ? "Tu líder te la devolvió" : "Devuelta"}: {a.returnComment}
        </div>
      )}

      {a.doneComment && (a.status === "HECHA" || a.status === "APROBADA") && (
        <div className="mt-1.5">
          <div className="text-[12.5px] text-ink whitespace-pre-wrap break-words">
            <span className="text-steel">{role === "member" ? "Tu comentario" : "Comentario"}:</span> {a.doneComment}
          </div>
          {a.donePhotoUrl && (
            <div className="mt-1.5">
              <ProofPreview url={a.donePhotoUrl} filename="tarea.jpg" size={56} />
            </div>
          )}
          {a.status === "APROBADA" && a.reviewedAt && (
            <div className="text-[11.5px] text-green mt-1">
              Aprobada {a.reviewedByName ? `por ${a.reviewedByName} ` : ""}· {formatStamp(a.reviewedAt)}
            </div>
          )}
        </div>
      )}

      {err && <div className="text-[12px] text-red mt-2">{err}</div>}

      {/* Acciones del colaborador */}
      {role === "member" && isOpen && mode === null && (
        <div className="flex items-center gap-2 flex-wrap mt-2">
          {a.status !== "EN_PROCESO" && (
            <button type="button" disabled={busy} onClick={() => act({ action: "start" })} className="text-[12.5px] font-semibold text-blue border border-blue/50 px-3 py-1.5 rounded-md cursor-pointer disabled:opacity-50">
              Empezar
            </button>
          )}
          <button type="button" disabled={busy} onClick={() => setMode("done")} className="text-[12.5px] font-semibold text-white bg-green px-3 py-1.5 rounded-md cursor-pointer disabled:opacity-50">
            Marcar como hecha
          </button>
        </div>
      )}
      {role === "member" && a.status === "HECHA" && <div className="text-[12px] text-steel mt-2">Esperando que tu líder la revise.</div>}

      {mode === "done" && (
        <div className="mt-2 space-y-2">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            placeholder="¿Qué hiciste? (obligatorio)"
            className="w-full bg-cloud border border-rule rounded-md p-2 text-[13px] text-ink"
          />
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-[12px] font-semibold text-blue cursor-pointer flex items-center gap-1">
              <Paperclip size={13} /> {uploading ? "Subiendo…" : photo ? "Cambiar foto" : "Subir foto (opcional)"}
              <input
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onPhoto(f);
                  e.target.value = "";
                }}
              />
            </label>
            {photo && <ProofPreview url={photo.url} filename={photo.name} size={40} />}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy || uploading || !comment.trim()}
              onClick={() => act({ action: "done", comment, photoUrl: photo?.url ?? null })}
              className="text-[12.5px] font-semibold text-white bg-green px-3 py-1.5 rounded-md cursor-pointer disabled:opacity-50"
            >
              {busy ? "Guardando…" : "Enviar a mi líder"}
            </button>
            <button type="button" onClick={() => { setMode(null); setComment(""); setPhoto(null); }} className="text-[12.5px] text-steel cursor-pointer">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Acciones del líder */}
      {role === "leader" && mode === null && (a.status === "HECHA" || isOpen) && (
        <div className="flex items-center gap-2 flex-wrap mt-2">
          {a.status === "HECHA" && (
            <>
              <button type="button" disabled={busy} onClick={() => act({ action: "approve" })} className="text-[12.5px] font-semibold text-white bg-green px-3 py-1.5 rounded-md cursor-pointer disabled:opacity-50">
                Aprobar
              </button>
              <button type="button" disabled={busy} onClick={() => setMode("return")} className="text-[12.5px] font-semibold text-red border border-red/50 px-3 py-1.5 rounded-md cursor-pointer disabled:opacity-50">
                Devolver
              </button>
            </>
          )}
          {isOpen && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (confirm(`¿Cancelar esta tarea para ${a.assigneeName}? Ya no tendrá que hacerla.`)) act({ action: "cancel" });
              }}
              className="text-[12px] text-steel hover:text-red cursor-pointer disabled:opacity-50"
            >
              Cancelar tarea
            </button>
          )}
        </div>
      )}

      {mode === "return" && (
        <div className="mt-2 space-y-2">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            placeholder="¿Qué falta o qué hay que corregir? (obligatorio)"
            className="w-full bg-cloud border border-rule rounded-md p-2 text-[13px] text-ink"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy || !comment.trim()}
              onClick={() => act({ action: "return", comment })}
              className="text-[12.5px] font-semibold text-white bg-red px-3 py-1.5 rounded-md cursor-pointer disabled:opacity-50"
            >
              {busy ? "Guardando…" : "Devolver"}
            </button>
            <button type="button" onClick={() => { setMode(null); setComment(""); }} className="text-[12.5px] text-steel cursor-pointer">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {a.events.length > 0 && (
        <div className="mt-2">
          <button type="button" onClick={() => setShowHistory((v) => !v)} className="text-[11.5px] text-steel hover:text-ink flex items-center gap-1 cursor-pointer">
            {showHistory ? <ChevronUp size={12} /> : <ChevronDown size={12} />} Historial
          </button>
          {showHistory && (
            <ul className="mt-1.5 space-y-1 border-l border-rule pl-3">
              {a.events.map((e, i) => (
                <li key={i} className="text-[11.5px] text-steel">
                  <span className="font-mono">{formatStamp(e.createdAt)}</span> · <span className="text-ink">{EVENT_LABEL[e.kind] ?? e.kind}</span>
                  {e.actorName && <> · {e.actorName}</>}
                  {e.comment && <span className="block text-ink/90 whitespace-pre-wrap break-words">“{e.comment}”</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function CreateTaskForm({ members, onCancel, onCreated }: { members: { id: string; name: string }[]; onCancel: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [attachment, setAttachment] = useState<{ url: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allSelected = members.length > 0 && selected.size === members.length;
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const onFile = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const up = await uploadTaskFile(file);
      setAttachment({ url: up.url, name: file.name });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo subir el archivo.");
    } finally {
      setUploading(false);
    }
  };

  const canSave = title.trim() && dueDate && selected.size > 0 && !uploading;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await postJson("/api/team-tasks", {
        title,
        description: description.trim() || null,
        dueDate,
        urgent,
        attachmentUrl: attachment?.url ?? null,
        attachmentName: attachment?.name ?? null,
        assigneeIds: [...selected],
      });
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear la tarea.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl">
      <button type="button" onClick={onCancel} className="text-[12.5px] text-steel hover:text-ink mb-4 cursor-pointer">
        ← Volver a las tareas
      </button>
      <h2 className="font-display text-[19px] font-bold mb-4">Nueva tarea</h2>
      {error && <div className="text-[13px] text-red mb-3">{error}</div>}

      <div className="space-y-3">
        <label className="text-[12px] text-steel flex flex-col gap-1">
          ¿Qué hay que hacer?
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className="bg-cloud border border-rule rounded-md p-2 text-[13px] text-ink" />
        </label>
        <label className="text-[12px] text-steel flex flex-col gap-1">
          Detalle (opcional)
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="bg-cloud border border-rule rounded-md p-2 text-[13px] text-ink" />
        </label>
        <div className="flex items-end gap-4 flex-wrap">
          <label className="text-[12px] text-steel flex flex-col gap-1">
            Fecha límite
            <input type="date" value={dueDate} min={todayEc()} onChange={(e) => setDueDate(e.target.value)} className="bg-cloud border border-rule rounded-md p-2 text-[13px] text-ink" />
          </label>
          <label className="text-[13px] text-ink flex items-center gap-2 pb-2 cursor-pointer">
            <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} /> Urgente
          </label>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-[12px] text-steel">¿A quién se la das? (puedes elegir varias personas)</div>
            {members.length > 1 && (
              <button
                type="button"
                onClick={() => setSelected(allSelected ? new Set() : new Set(members.map((m) => m.id)))}
                className="text-[12px] font-semibold text-blue cursor-pointer"
              >
                {allSelected ? "Quitar a todos" : "Elegir a todos"}
              </button>
            )}
          </div>
          {members.length === 0 ? (
            <div className="text-[12.5px] text-steel">No hay colaboradores activos en tu área.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {members.map((m) => (
                <label key={m.id} className={`flex items-center gap-2 border rounded-md px-3 py-2 text-[13px] cursor-pointer ${selected.has(m.id) ? "border-teal bg-teal/10 text-ink" : "border-rule text-ink"}`}>
                  <input type="checkbox" checked={selected.has(m.id)} onChange={() => toggle(m.id)} /> {m.name}
                </label>
              ))}
            </div>
          )}
          {selected.size > 1 && <div className="text-[11.5px] text-steel mt-1.5">Cada persona la avanza por su lado y tú apruebas a cada una por separado.</div>}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-[12px] font-semibold text-blue cursor-pointer flex items-center gap-1">
            <Paperclip size={13} /> {uploading ? "Subiendo…" : attachment ? "Cambiar adjunto" : "Adjuntar foto o archivo (opcional)"}
            <input
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
                e.target.value = "";
              }}
            />
          </label>
          {attachment && (
            <>
              <ProofPreview url={attachment.url} filename={attachment.name} size={40} />
              <button type="button" onClick={() => setAttachment(null)} className="text-[11.5px] text-red cursor-pointer">
                Quitar
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 mt-5">
        <button type="button" disabled={!canSave || saving} onClick={save} className="text-[13px] font-semibold text-white bg-blue px-4 py-2 rounded-md cursor-pointer disabled:opacity-50">
          {saving ? "Asignando…" : `Asignar tarea${selected.size > 1 ? ` a ${selected.size} personas` : ""}`}
        </button>
        <button type="button" onClick={onCancel} className="text-[13px] text-steel cursor-pointer">
          Cancelar
        </button>
      </div>
    </div>
  );
}
