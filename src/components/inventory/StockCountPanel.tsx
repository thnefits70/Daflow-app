"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ClipboardList, Clock, Search, UserCheck } from "lucide-react";
import type { CountView } from "@/lib/stockCount";
import type { AssignmentBoard, AssignmentView } from "@/lib/stockCountAssignments";
import { WAREHOUSE_AREAS, areaLabel } from "@/lib/warehouseAreas";

type Data = { count: CountView | null; fullCompleted: boolean; weeklyArea: string | null; isLead: boolean; board: AssignmentBoard | null };

function hour(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-EC", { hour: "numeric", minute: "2-digit", timeZone: "America/Guayaquil" });
}

function clock(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return `${h > 0 ? `${h}:` : ""}${String(m).padStart(h > 0 ? 2 : 1, "0")}:${String(s).padStart(2, "0")}`;
}

function minutes(sec: number): string {
  const m = Math.max(1, Math.round(sec / 60));
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

// Conteo físico de inventario (pedido del usuario 2026-10-02). A CIEGAS:
// aquí nunca se ve lo que dice el sistema, solo se escribe cuánto hay.
// Desde 2026-10-05 Daniel asigna cada área a una persona con un horario; la
// persona empieza (corre su tiempo), cuenta del que menos se vende al que
// más y avisa cuando termina.
export function StockCountPanel() {
  const [data, setData] = useState<Data | null>(null);
  const [area, setArea] = useState<string>("");
  const [q, setQ] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [confirmSend, setConfirmSend] = useState(false);
  const [confirmStart, setConfirmStart] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  function load() {
    fetch("/api/stock-count", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => setData(null));
  }
  useEffect(load, []);

  const count = data?.count ?? null;
  const board = data?.board ?? null;
  const mine = board?.mine ?? null;
  const isLead = !!data?.isLead;
  const now = useNow(!!mine?.startedAt);

  const visible = useMemo(() => {
    if (!count) return [];
    const nq = q.trim().toLowerCase();
    return count.products.filter((p) => (count.kind === "WEEKLY_AREA" || !isLead || !area || (area === "NONE" ? !p.area : p.area === area)) && (!nq || p.name.toLowerCase().includes(nq) || (p.justCode ?? "").includes(nq)));
  }, [count, area, q, isLead]);

  async function post(url: string, body?: unknown): Promise<{ ok: boolean; json: Record<string, unknown> | null }> {
    setErr("");
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const json = await res.json().catch(() => null);
    if (!res.ok) setErr((json?.error as string) ?? "No se pudo guardar.");
    return { ok: res.ok, json };
  }

  async function save(productId: string) {
    if (!count) return;
    const raw = drafts[productId];
    if (raw === undefined || raw.trim() === "") return;
    const quantity = Number(raw);
    if (!Number.isInteger(quantity) || quantity < 0) return setErr("Escribe una cantidad entera, 0 o mayor.");
    setSaving(productId);
    const r = await post(`/api/stock-count/${count.id}/line`, { catalogItemId: productId, quantity });
    setSaving(null);
    if (!r.ok) return;
    setDrafts((d) => {
      const n = { ...d };
      delete n[productId];
      return n;
    });
    load();
  }

  async function start() {
    setBusy(true);
    await post("/api/stock-count", { action: "start-full" });
    setBusy(false);
    setConfirmStart(false);
    load();
  }

  async function assignmentAction(a: AssignmentView, action: "start" | "finish") {
    setBusy(true);
    const r = await post(`/api/stock-count/assignment/${a.id}`, { action });
    setBusy(false);
    if (r.ok && action === "finish") setMsg(`¡Listo! Terminaste ${a.area === "RECOUNT" ? "el recuento" : a.label}. Ya le avisamos a Daniel.`);
    load();
  }

  async function send() {
    if (!count) return;
    setBusy(true);
    const r = await post(`/api/stock-count/${count.id}/submit`);
    setBusy(false);
    setConfirmSend(false);
    if (!r.ok) return;
    const differences = Number(r.json?.differences ?? 0);
    setMsg(differences > 0 ? `Enviado: ${differences} producto(s) con diferencia pasan a aprobación del administrador.` : "Enviado: todo cuadró, no hay nada que ajustar.");
    load();
  }

  if (!data) return <div className="text-steel text-[13px]">Cargando…</div>;

  if (!count) {
    return (
      <div className="text-[13px] max-w-xl">
        {msg && <div className="text-teal mb-2">{msg}</div>}
        {data.fullCompleted ? (
          <div className="text-steel">No hay un conteo abierto esta semana.</div>
        ) : isLead ? (
          <>
            <p className="mb-2">Todavía no se hizo el conteo general. Antes de empezar, confirma todos los cortes pendientes: lo que ya salió debe estar descontado.</p>
            {confirmStart ? (
              <div className="bg-cloud border border-gold/50 rounded p-2.5">
                ¿Iniciar el conteo general de toda la bodega? Después asignas cada área a una persona de tu equipo.
                <div className="flex gap-2 mt-2">
                  <button type="button" disabled={busy} className="rounded border border-gold bg-gold px-3 py-1.5 font-bold text-navy cursor-pointer" onClick={start}>Sí, iniciar</button>
                  <button type="button" className="text-steel cursor-pointer" onClick={() => setConfirmStart(false)}>Cancelar</button>
                </div>
              </div>
            ) : (
              <button type="button" className="rounded border border-teal bg-teal px-3.5 py-2 font-bold text-navy cursor-pointer" onClick={() => setConfirmStart(true)}>Iniciar conteo general</button>
            )}
          </>
        ) : (
          <div className="text-steel">Todavía no hay un conteo abierto. Daniel lo inicia.</div>
        )}
        {err && <div className="text-red mt-2">{err}</div>}
      </div>
    );
  }

  const counted = count.products.filter((p) => p.countedQty !== null).length;
  const total = count.products.length;
  const locked = count.status !== "COUNTING";
  const mineIds = new Set(mine?.productIds ?? []);
  const recounting = mine?.area === "RECOUNT";
  const canEdit = (p: CountView["products"][number]) => {
    if (recounting && mineIds.has(p.id)) return !!mine?.startedAt && p.recount;
    if (locked) return false;
    if (mine && mineIds.has(p.id)) return !!mine.startedAt;
    return isLead;
  };
  // Quien no es Daniel solo ve la lista cuando ya empezó.
  const showList = isLead || !!mine?.startedAt;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-2">
        <h2 className="font-display text-[17px] font-bold flex items-center gap-2">
          <ClipboardList size={17} /> {count.kind === "FULL" ? "Conteo general" : `Conteo semanal · ${areaLabel(count.area)}`}
        </h2>
        {isLead && (
          <span className="text-[12.5px] text-steel">
            Contados <b className="text-ink">{counted}</b> de {total}
          </span>
        )}
        {locked && <span className="text-[11px] font-bold uppercase rounded-full px-2 py-0.5 border border-gold/50 bg-gold/15">{count.status === "SUBMITTED" ? "Enviado — esperando aprobación" : "Aprobado"}</span>}
      </div>
      {msg && <div className="text-teal text-[12.5px] mb-2">{msg}</div>}
      {err && <div className="text-red text-[12.5px] mb-2">{err}</div>}

      {isLead && board && <AssignBoard count={count} board={board} busy={busy} setBusy={setBusy} post={post} reload={load} />}

      {mine ? (
        <MyAssignment a={mine} now={now} board={board} busy={busy} onAction={(action) => assignmentAction(mine, action)} />
      ) : (
        !isLead && <div className="text-[13px] text-steel bg-cloud border border-rule rounded p-3 max-w-xl">Todavía no tienes un área asignada. Cuando Daniel te asigne una, te llega un aviso y aparece en tu Inicio.</div>
      )}

      {showList && (
        <>
          <div className="text-[12px] bg-cloud border border-rule rounded p-2.5 mb-3 max-w-2xl">
            Cuenta lo que hay físicamente y escribe el número. Van primero los que <b>menos se venden</b>. <b>No cuentes</b> lo que ya está separado para un corte ni la mercadería recién llegada sin registrar. Si un producto está en dos lugares, <b>suma todo</b> antes de escribirlo. Si no está, escribe <b>0</b>.
          </div>

          <div className="flex flex-wrap items-center gap-2 mb-3">
            {count.kind === "FULL" && isLead && (
              <>
                <button type="button" className={`rounded-full border px-2.5 py-1 text-[12px] cursor-pointer ${area === "" ? "bg-teal border-teal text-navy font-bold" : "border-rule"}`} onClick={() => setArea("")}>Todas</button>
                {[...WAREHOUSE_AREAS, "NONE"].map((a) => {
                  const inArea = count.products.filter((p) => (a === "NONE" ? !p.area : p.area === a));
                  if (inArea.length === 0) return null;
                  const done = inArea.filter((p) => p.countedQty !== null).length;
                  return (
                    <button key={a} type="button" className={`rounded-full border px-2.5 py-1 text-[12px] cursor-pointer ${area === a ? "bg-teal border-teal text-navy font-bold" : done === inArea.length ? "border-green bg-green/15" : "border-rule"}`} onClick={() => setArea(a)}>
                      {a === "NONE" ? "Sin área" : `Área ${a}`} <span className="font-mono">{done}/{inArea.length}</span>
                    </button>
                  );
                })}
              </>
            )}
            <span className="relative">
              <Search size={13} className="absolute left-2 top-2 text-steel" />
              <input className="rounded border border-rule bg-surface pl-7 pr-2 py-1 text-[12.5px] w-56" placeholder="Buscar producto o ID" value={q} onChange={(e) => setQ(e.target.value)} />
            </span>
          </div>

          <div className="flex flex-col gap-1.5 max-w-3xl">
            {visible.map((p, i) => {
              const editable = canEdit(p);
              const done = p.countedQty !== null && !(recounting && p.recount);
              return (
                <div key={p.id} className={`flex items-center gap-2 border rounded p-2 text-[12.5px] ${done ? "border-green/50 bg-green/5" : p.recount ? "border-gold/60 bg-gold/5" : "border-rule"}`}>
                  <span className="text-steel font-mono text-[11px] w-6 text-right shrink-0">{i + 1}</span>
                  {p.photo && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.photo} alt="" className="w-10 h-10 rounded object-cover shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold truncate">{p.name}</div>
                    <div className="text-steel font-mono text-[11px]">
                      {p.justCode ?? "sin ID"} · {areaLabel(p.area)}
                      {p.recount && " · para recontar"}
                      {p.countedQty !== null && ` · contado ${p.countedQty}${p.countedByName && isLead ? ` por ${p.countedByName}` : ""}`}
                    </div>
                  </div>
                  {editable && (
                    <>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        className="w-20 rounded border border-rule bg-surface px-2 py-1.5 text-[14px] text-right"
                        placeholder={p.countedQty !== null ? String(p.countedQty) : "¿Cuántos?"}
                        value={drafts[p.id] ?? ""}
                        onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                        onKeyDown={(e) => e.key === "Enter" && save(p.id)}
                      />
                      <button type="button" disabled={saving === p.id || !(drafts[p.id] ?? "").trim()} className="rounded border border-teal bg-teal px-2.5 py-1.5 font-bold text-navy cursor-pointer disabled:opacity-40" onClick={() => save(p.id)}>
                        {saving === p.id ? "…" : p.countedQty !== null ? "Corregir" : "Guardar"}
                      </button>
                    </>
                  )}
                  {done && <CheckCircle2 size={15} className="text-green shrink-0" />}
                </div>
              );
            })}
          </div>
        </>
      )}

      {isLead && !locked && (
        <div className="mt-4 max-w-2xl">
          {confirmSend ? (
            <div className="bg-cloud border border-gold/50 rounded p-3 text-[12.5px]">
              <b>¿Enviar el conteo?</b> Ya no se podrá cambiar lo contado. Las diferencias le llegan al administrador en una lista para aprobarlas.
              {counted < total && <div className="text-gold font-semibold mt-1">Faltan {total - counted} producto(s) por contar: esos no se ajustan.</div>}
              <div className="flex gap-2 mt-2">
                <button type="button" disabled={busy} className="rounded border border-gold bg-gold px-3 py-1.5 font-bold text-navy cursor-pointer" onClick={send}>{busy ? "Enviando…" : "Sí, enviar"}</button>
                <button type="button" className="text-steel cursor-pointer" onClick={() => setConfirmSend(false)}>Cancelar</button>
              </div>
            </div>
          ) : (
            <button type="button" disabled={counted === 0} className="rounded border border-teal bg-teal px-3.5 py-2 font-bold text-navy cursor-pointer disabled:opacity-50" onClick={() => setConfirmSend(true)}>
              Revisé el conteo — enviar a aprobación ({counted}/{total})
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Tarjeta de la persona asignada: empezar, cronómetro, meta y terminar.
function MyAssignment({ a, now, board, busy, onAction }: { a: AssignmentView; now: number; board: AssignmentBoard | null; busy: boolean; onAction: (action: "start" | "finish") => void }) {
  const what = a.area === "RECOUNT" ? `Recontar ${a.total} producto(s)` : `Contar ${a.label}`;
  const elapsed = a.startedAt ? now - new Date(a.startedAt).getTime() : 0;
  const overEstimate = a.estimateSec !== null && elapsed > a.estimateSec * 1000;
  const pastDeadline = now > new Date(a.deadline).getTime();
  const w = board?.window;
  return (
    <div className={`border rounded-md p-3 mb-3 max-w-2xl ${a.late || pastDeadline ? "border-red/60 bg-red/5" : "border-teal/60 bg-teal/5"}`}>
      <div className="font-display font-bold text-[15px] flex items-center gap-2">
        <UserCheck size={16} /> {what}
      </div>
      <div className="text-[12.5px] mt-1">
        {a.total} producto(s) · Meta: terminar antes de las <b>{hour(a.deadline)}</b>
        {a.estimateSec !== null && <> · Tiempo estimado: <b>{minutes(a.estimateSec)}</b></>}
      </div>
      {w && !w.inWindow && w.nextStart && <div className="text-[12.5px] text-gold font-semibold mt-1">Ahora toca sacar el corte. Sigue contando a las {hour(w.nextStart)}; lo que ya contaste no se pierde.</div>}
      {!a.startedAt ? (
        <button type="button" disabled={busy} className="mt-2 rounded border border-teal bg-teal px-3.5 py-2 font-bold text-navy cursor-pointer disabled:opacity-50" onClick={() => onAction("start")}>
          Empezar conteo
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-3 mt-2">
          <span className={`flex items-center gap-1.5 font-mono text-[18px] font-bold ${overEstimate || pastDeadline ? "text-red" : "text-ink"}`}>
            <Clock size={16} /> {clock(elapsed)}
          </span>
          <span className="text-[12.5px] text-steel">
            Contados <b className="text-ink">{a.done}</b> de {a.total}
            {(overEstimate || pastDeadline) && <b className="text-red"> · vas atrasado</b>}
          </span>
          <button type="button" disabled={busy || a.done < a.total} className="rounded border border-green bg-green px-3 py-1.5 font-bold text-navy cursor-pointer disabled:opacity-40" onClick={() => onAction("finish")}>
            {a.done < a.total ? `Faltan ${a.total - a.done}` : `Terminé ${a.area === "RECOUNT" ? "el recuento" : a.label}`}
          </button>
        </div>
      )}
    </div>
  );
}

// Para Daniel: cada área con su persona, horario y avance.
function AssignBoard({ count, board, busy, setBusy, post, reload }: {
  count: CountView;
  board: AssignmentBoard;
  busy: boolean;
  setBusy: (b: boolean) => void;
  post: (url: string, body?: unknown) => Promise<{ ok: boolean }>;
  reload: () => void;
}) {
  const [person, setPerson] = useState<Record<string, string>>({});
  const [slot, setSlot] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const busyPeople = new Map<string, string>();
  for (const a of [...board.areas.map((x) => x.assignment), ...board.recounts]) if (a && !a.finishedAt) busyPeople.set(a.assigneeId, a.area);

  async function assign(area: string) {
    const assigneeId = person[area];
    const dueAt = slot[area] ?? board.windows[0]?.end;
    if (!assigneeId || !dueAt) return;
    setBusy(true);
    const r = await post(`/api/stock-count/${count.id}/assign`, { area, assigneeId, dueAt });
    setBusy(false);
    if (r.ok) setEditing(null);
    reload();
  }

  function picker(area: string, exclude: Set<string> = new Set()) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <select className="rounded border border-rule bg-surface px-2 py-1 text-[12.5px]" value={person[area] ?? ""} onChange={(e) => setPerson((s) => ({ ...s, [area]: e.target.value }))}>
          <option value="">¿Quién cuenta?</option>
          {board.team.map((t) => {
            const other = busyPeople.get(t.id);
            const disabled = exclude.has(t.id) || (!!other && other !== area);
            return (
              <option key={t.id} value={t.id} disabled={disabled}>
                {t.name}{other && other !== area ? ` (contando ${other === "RECOUNT" ? "recuento" : other === "NONE" ? "sin área" : `área ${other}`})` : ""}
              </option>
            );
          })}
        </select>
        <select className="rounded border border-rule bg-surface px-2 py-1 text-[12.5px]" value={slot[area] ?? board.windows[0]?.end ?? ""} onChange={(e) => setSlot((s) => ({ ...s, [area]: e.target.value }))}>
          {board.windows.map((w) => (
            <option key={w.end} value={w.end}>{w.label}</option>
          ))}
        </select>
        <button type="button" disabled={busy || !person[area]} className="rounded border border-teal bg-teal px-2.5 py-1 text-[12.5px] font-bold text-navy cursor-pointer disabled:opacity-40" onClick={() => assign(area)}>
          Asignar
        </button>
        {editing === area && <button type="button" className="text-steel text-[12px] cursor-pointer" onClick={() => setEditing(null)}>Cancelar</button>}
      </div>
    );
  }

  const recountCounters = new Set(count.products.filter((p) => p.recount).map((p) => p.countedByName));
  const recountExclude = new Set(board.team.filter((t) => recountCounters.has(t.name)).map((t) => t.id));

  return (
    <section className="border border-rule rounded-md p-3 mb-4 max-w-4xl">
      <div className="font-display font-bold text-[14px] mb-1">Asignar áreas</div>
      <div className="text-[12px] text-steel mb-2">
        Una persona por área, una área a la vez. Se cuenta entre cortes: 8:45–11:45, 12:15–13:45 y 14:15–16:45 (sábado 9:00–12:00). A la persona le llega un aviso y le sale en su Inicio; cuando termine, te avisa para que asignes la siguiente.
      </div>
      {count.status === "COUNTING" && (
        <div className="flex flex-col gap-1.5">
          {board.areas.filter((x) => x.total > 0).map(({ area, label, total, assignment: a }) => (
            <div key={area} className={`flex flex-wrap items-center gap-2 border rounded p-2 text-[12.5px] ${a?.finishedAt ? "border-green/50 bg-green/5" : a?.late ? "border-red/50 bg-red/5" : "border-rule"}`}>
              <div className="w-28 shrink-0">
                <b>{label}</b> <span className="text-steel">· {total}</span>
              </div>
              {a && editing !== area ? (
                <div className="flex-1 flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{a.assigneeName}</span>
                  {a.finishedAt ? (
                    <span className="text-green">✓ terminó{a.startedAt ? ` en ${minutes((new Date(a.finishedAt).getTime() - new Date(a.startedAt).getTime()) / 1000)}` : ""}</span>
                  ) : (
                    <>
                      <span className="text-steel">{a.startedAt ? `contando desde las ${hour(a.startedAt)} · ${a.done}/${a.total}` : "todavía no empieza"} · meta {hour(a.deadline)}</span>
                      {a.late && <b className="text-red">⏰ atrasado</b>}
                      <button type="button" className="text-teal text-[12px] underline cursor-pointer" onClick={() => setEditing(area)}>Cambiar persona u horario</button>
                    </>
                  )}
                </div>
              ) : (
                picker(area)
              )}
            </div>
          ))}
        </div>
      )}
      {(board.unassignedRecount > 0 || board.recounts.length > 0) && (
        <div className="mt-3">
          <div className="font-semibold text-[13px] mb-1">🔁 Recuento pedido por el administrador</div>
          {board.recounts.map((a) => (
            <div key={a.id} className="text-[12.5px] text-steel mb-1">
              {a.assigneeName}: {a.total} producto(s) · {a.finishedAt ? "✓ terminó" : `${a.done}/${a.total} · meta ${hour(a.deadline)}${a.late ? " · ⏰ atrasado" : ""}`}
            </div>
          ))}
          {board.unassignedRecount > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
              <span>{board.unassignedRecount} producto(s) sin asignar — elige a <b>otra persona</b> (no a quien los contó):</span>
              {picker("RECOUNT", recountExclude)}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
