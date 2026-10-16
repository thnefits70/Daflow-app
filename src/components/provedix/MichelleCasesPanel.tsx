"use client";

import { useEffect, useState } from "react";
import { formatDateTime } from "@/lib/formatDateTime";

type Case = {
  id: string;
  code: string;
  topic: string;
  topicLabel: string;
  platform: string;
  summary: string;
  guideNumber: string | null;
  status: string;
  resolution: string | null;
  resolvedAt: string | null;
  createdAt: string;
  who: string;
  whatsapp: string | null;
  store: string | null;
};
type Answer = {
  id: string;
  question: string;
  answer: string;
  active: boolean;
  updatedAt: string;
};
type Msg = { role: string; content: string; at: string; attachments?: { id: string; kind: string }[]; team?: boolean };

// Casos que Michelle IA pasa a Michelle (la asesora humana) y lo que ella le
// enseña (2026-10-15). Ver src/lib/provedixCases.ts.
export function MichelleCasesPanel() {
  const [tab, setTab] = useState<"casos" | "respuestas">("casos");
  const [cases, setCases] = useState<Case[] | null>(null);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [error, setError] = useState("");

  function load() {
    fetch("/api/provedix/cases")
      .then((r) => r.json())
      .then((d) => {
        setCases(Array.isArray(d?.cases) ? d.cases : []);
        setAnswers(Array.isArray(d?.answers) ? d.answers : []);
      })
      .catch(() => setCases([]));
  }
  useEffect(load, []);

  if (cases === null)
    return <div className="text-[12.5px] text-steel">Cargando…</div>;
  const open = cases.filter((c) => c.status === "ABIERTO");
  const done = cases.filter((c) => c.status !== "ABIERTO");

  return (
    <div>
      <div className="flex gap-6 border-b border-rule mb-5">
        {[
          ["casos", `Casos${open.length ? ` (${open.length})` : ""}`],
          [
            "respuestas",
            `Lo que sabe Michelle IA (${answers.filter((a) => a.active).length})`,
          ],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id as "casos" | "respuestas")}
            className={`pb-2.5 text-[13.5px] font-semibold cursor-pointer border-b-2 ${tab === id ? "border-teal text-ink" : "border-transparent text-steel hover:text-ink"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {error && <div className="mb-3 text-[12px] text-red">{error}</div>}

      {tab === "casos" ? (
        <div className="flex flex-col gap-3">
          {open.length === 0 && (
            <div className="rounded-lg border border-rule bg-cloud px-3 py-3 text-[12.5px] text-steel">
              No hay casos abiertos. Michelle IA está resolviendo todo. ✅
            </div>
          )}
          {open.map((c) => (
            <CaseCard key={c.id} c={c} onDone={load} onError={setError} />
          ))}
          {done.length > 0 && (
            <div className="mt-4">
              <div className="mb-1.5 text-[12px] font-semibold">
                Resueltos (últimos 30 días)
              </div>
              {done.map((c) => (
                <div
                  key={c.id}
                  className="border-t border-rule py-2 text-[12px]"
                >
                  <span className="font-mono font-semibold">{c.code}</span> ·{" "}
                  {c.topicLabel} · {c.who}
                  <div className="text-steel">
                    {c.resolution}{" "}
                    {c.resolvedAt ? `· ${formatDateTime(c.resolvedAt)}` : ""}
                  </div>
                  <ReplyBox caseId={c.id} />
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <AnswersEditor answers={answers} onChanged={load} onError={setError} />
      )}
    </div>
  );
}

// Mensaje al dropshipper en su chat de Michelle IA, también en casos resueltos.
function ReplyBox({ caseId }: { caseId: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [state, setState] = useState<"" | "busy" | "sent" | string>("");

  async function send() {
    setState("busy");
    const res = await fetch(`/api/provedix/cases/${caseId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reply: text }),
    });
    const d = await res.json().catch(() => null);
    if (res.ok) {
      setText("");
      setOpen(false);
      setState("sent");
    } else setState(d?.error ?? "No se pudo enviar.");
  }

  if (!open)
    return (
      <div className="mt-1 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-[12px] font-semibold text-teal hover:underline cursor-pointer"
        >
          Enviar mensaje al dropshipper
        </button>
        {state === "sent" && (
          <span className="text-[12px] text-steel">
            ✅ Enviado: lo verá en su chat cuando lo abra.
          </span>
        )}
      </div>
    );
  return (
    <div className="mt-1.5">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        maxLength={1000}
        className="w-full rounded-md border border-rule bg-surface px-2.5 py-2 text-[13px]"
        placeholder="Le aparece en su chat con Michelle IA. Escríbelo corto, como por WhatsApp."
      />
      {state && state !== "busy" && state !== "sent" && (
        <div className="text-[12px] text-red">{state}</div>
      )}
      <div className="mt-1 flex gap-2">
        <button
          type="button"
          disabled={state === "busy" || text.trim().length < 2}
          onClick={send}
          className="rounded border border-teal bg-teal px-3 py-1 text-[12px] font-bold text-navy cursor-pointer disabled:opacity-50"
        >
          {state === "busy" ? "Enviando…" : "Enviar"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[12px] text-steel hover:text-ink cursor-pointer"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

function CaseCard({
  c,
  onDone,
  onError,
}: {
  c: Case;
  onDone: () => void;
  onError: (e: string) => void;
}) {
  const [showChat, setShowChat] = useState(false);
  const [chat, setChat] = useState<Msg[] | null>(null);
  const [resolution, setResolution] = useState("");
  const [reply, setReply] = useState("");
  const [teach, setTeach] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!showChat || chat) return;
    let alive = true;
    fetch(`/api/provedix/cases/${c.id}`)
      .then((r) => r.json())
      .then((d) => alive && setChat(Array.isArray(d) ? d : []))
      .catch(() => alive && setChat([]));
    return () => {
      alive = false;
    };
  }, [showChat, chat, c.id]);

  async function resolve() {
    setBusy(true);
    onError("");
    const res = await fetch(`/api/provedix/cases/${c.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resolution,
        reply,
        teach: teach ? { question, answer } : null,
      }),
    });
    const d = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) onError(d?.error ?? "No se pudo guardar.");
    else onDone();
  }

  return (
    <div className="rounded-lg border border-rule bg-surface p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[14px] font-bold">
            <span className="font-mono">{c.code}</span> · {c.topicLabel}
            <span className="ml-2 rounded-full bg-cloud px-2 py-0.5 align-middle text-[11px] font-semibold text-steel">{c.platform}</span>
          </div>
          <div className="text-[12px] text-steel">
            {c.who}
            {c.store ? ` · ${c.store}` : ""}
            {c.whatsapp ? ` · ${c.whatsapp}` : ""}
            {c.guideNumber ? ` · Guía ${c.guideNumber}` : ""} ·{" "}
            {formatDateTime(c.createdAt)}
          </div>
        </div>
      </div>
      <div className="mt-2 whitespace-pre-wrap rounded-md bg-cloud px-3 py-2 text-[13px]">
        {c.summary}
      </div>
      <button
        type="button"
        onClick={() => setShowChat(!showChat)}
        className="mt-2 text-[12px] font-semibold text-steel hover:text-ink cursor-pointer"
      >
        {showChat ? "Ocultar conversación" : "Ver la conversación completa"}
      </button>
      {showChat && (
        <div className="mt-2 flex max-h-[360px] flex-col gap-2 overflow-y-auto rounded-md border border-rule p-2">
          {chat === null && (
            <div className="text-[12px] text-steel">Cargando…</div>
          )}
          {chat?.map((m, i) => (
            <div
              key={i}
              className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-[12.5px] ${m.role === "user" ? "self-end bg-ink text-bg" : "self-start border border-rule bg-surface"}`}
            >
              <div
                className={`mb-0.5 text-[10.5px] ${m.role === "user" ? "text-bg opacity-70" : "text-steel"}`}
              >
                {m.role === "user" ? "Dropshipper" : m.team ? "Equipo" : "Michelle IA"} ·{" "}
                {formatDateTime(m.at)}
              </div>
              {m.content}
              {/* Fotos y videos que adjuntó en el chat (2026-10-16). */}
              {m.attachments?.map((a) =>
                a.kind === "video" ? (
                  <video key={a.id} src={`/api/provedix/cases/file/${a.id}`} controls preload="metadata" className="mt-1 max-h-64 w-full rounded-md" />
                ) : (
                  <a key={a.id} href={`/api/provedix/cases/file/${a.id}`} target="_blank" rel="noopener noreferrer" className="mt-1 block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/provedix/cases/file/${a.id}`} alt="Foto que adjuntó el dropshipper" className="max-h-64 rounded-md" loading="lazy" />
                  </a>
                ),
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 border-t border-rule pt-3">
        <label className="block text-[12px] font-semibold">
          ¿Cómo lo resolviste?
        </label>
        <textarea
          value={resolution}
          onChange={(e) => setResolution(e.target.value)}
          rows={2}
          className="mt-1 w-full rounded-md border border-rule bg-surface px-2.5 py-2 text-[13px]"
          placeholder="Ej.: Se aprobó la garantía y se reenvía el protector que faltó."
        />
        <label className="mt-2 block text-[12px] font-semibold">
          Respuesta para el dropshipper (opcional)
        </label>
        <textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          rows={2}
          maxLength={1000}
          className="mt-1 w-full rounded-md border border-rule bg-surface px-2.5 py-2 text-[13px]"
          placeholder="Le aparece en su chat con Michelle IA la próxima vez que lo abra. Escríbelo corto, como por WhatsApp."
        />
        <label className="mt-2 flex items-center gap-2 text-[12.5px] cursor-pointer">
          <input
            type="checkbox"
            checked={teach}
            onChange={(e) => {
              setTeach(e.target.checked);
              if (e.target.checked && !answer) setAnswer(resolution);
            }}
          />
          Enseñarle esto a Michelle IA (si la duda se puede repetir con otros
          dropshippers)
        </label>
        {teach && (
          <div className="mt-2 grid gap-2">
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              className="rounded-md border border-rule bg-surface px-2.5 py-2 text-[13px]"
              placeholder="La pregunta, como la haría un dropshipper. Ej.: ¿Cómo pido una talla XL en Dropi?"
            />
            <textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              rows={3}
              className="rounded-md border border-rule bg-surface px-2.5 py-2 text-[13px]"
              placeholder="Lo que Michelle IA debe responder la próxima vez."
            />
          </div>
        )}
        <button
          type="button"
          disabled={
            busy ||
            resolution.trim().length < 3 ||
            (teach && (!question.trim() || !answer.trim()))
          }
          onClick={resolve}
          className="mt-2 rounded border border-teal bg-teal px-3 py-1.5 text-[12.5px] font-bold text-navy cursor-pointer disabled:opacity-50"
        >
          {busy ? "Guardando…" : "Marcar resuelto"}
        </button>
      </div>
    </div>
  );
}

function AnswersEditor({
  answers,
  onChanged,
  onError,
}: {
  answers: Answer[];
  onChanged: () => void;
  onError: (e: string) => void;
}) {
  const [editing, setEditing] = useState<
    | Answer
    | { id?: undefined; question: string; answer: string; active: boolean }
    | null
  >(null);
  const [busy, setBusy] = useState(false);

  async function save(a: {
    id?: string;
    question: string;
    answer: string;
    active?: boolean;
  }) {
    setBusy(true);
    onError("");
    const res = await fetch("/api/provedix/answers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(a),
    });
    const d = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) onError(d?.error ?? "No se pudo guardar.");
    else {
      setEditing(null);
      onChanged();
    }
  }
  async function remove(id: string) {
    if (
      !window.confirm("¿Borrar esta respuesta? Michelle IA dejará de usarla.")
    )
      return;
    await fetch(`/api/provedix/answers?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    }).catch(() => null);
    onChanged();
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12.5px] text-steel">
        Estas respuestas las usa Michelle IA en el chat apenas las guardas.
        Escríbelas como le responderías a un dropshipper.
      </p>
      {editing ? (
        <div className="rounded-lg border border-teal bg-surface p-3">
          <input
            value={editing.question}
            onChange={(e) =>
              setEditing({ ...editing, question: e.target.value })
            }
            className="w-full rounded-md border border-rule bg-surface px-2.5 py-2 text-[13px]"
            placeholder="Pregunta del dropshipper"
          />
          <textarea
            value={editing.answer}
            onChange={(e) => setEditing({ ...editing, answer: e.target.value })}
            rows={4}
            className="mt-2 w-full rounded-md border border-rule bg-surface px-2.5 py-2 text-[13px]"
            placeholder="Respuesta"
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => save(editing)}
              className="rounded border border-teal bg-teal px-3 py-1.5 text-[12.5px] font-bold text-navy cursor-pointer disabled:opacity-50"
            >
              {busy ? "Guardando…" : "Guardar"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="rounded border border-rule px-3 py-1.5 text-[12.5px] font-semibold cursor-pointer"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setEditing({ question: "", answer: "", active: true })}
          className="self-start rounded border border-teal bg-teal px-3 py-1.5 text-[12.5px] font-bold text-navy cursor-pointer"
        >
          + Enseñar una respuesta nueva
        </button>
      )}
      {answers.length === 0 && (
        <div className="text-[12.5px] text-steel">
          Todavía no le enseñaste nada. Cada respuesta que agregues hará que te
          lleguen menos casos.
        </div>
      )}
      {answers.map((a) => (
        <div
          key={a.id}
          className={`rounded-lg border border-rule p-3 ${a.active ? "bg-surface" : "bg-cloud opacity-70"}`}
        >
          <div className="text-[13px] font-semibold">{a.question}</div>
          <div className="mt-1 whitespace-pre-wrap text-[12.5px] text-steel">
            {a.answer}
          </div>
          <div className="mt-2 flex flex-wrap gap-3 text-[12px] font-semibold">
            <button
              type="button"
              onClick={() => setEditing(a)}
              className="text-ink hover:underline cursor-pointer"
            >
              Editar
            </button>
            <button
              type="button"
              onClick={() =>
                save({
                  id: a.id,
                  question: a.question,
                  answer: a.answer,
                  active: !a.active,
                })
              }
              className="text-ink hover:underline cursor-pointer"
            >
              {a.active ? "Pausar" : "Volver a usar"}
            </button>
            <button
              type="button"
              onClick={() => remove(a.id)}
              className="text-red hover:underline cursor-pointer"
            >
              Borrar
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
