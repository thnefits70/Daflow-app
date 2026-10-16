"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, Upload, X } from "lucide-react";
import { uploadFile } from "@/lib/uploadFile";
import { formatDateTime } from "@/lib/formatDateTime";
import { usePasteFile } from "@/lib/usePasteFile";

type Item = { catalogItemId: string; name: string; quantity: number };
type Row = {
  id: string;
  code: string;
  status: string;
  originalGuide: string;
  originalShippedAt: string;
  clientName: string | null;
  city: string | null;
  items: Item[];
  reason: string;
  note: string | null;
  evidenceUrls: string[];
  dropiOrder: string;
  dropiAccount: string | null;
  guideNumber: string | null;
  guideLinkedAt: string | null;
  guideLinkedByName: string | null;
  shippedAt: string | null;
  createdById: string;
  createdByName: string | null;
  createdAt: string;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  cancelledAt: string | null;
};
type Role = { userId: string; isAdmin: boolean; canCreate: boolean; canApprove: boolean; canLinkGuide: boolean };
type Lookup = {
  guide: string;
  clientName: string | null;
  city: string | null;
  daysSince: number;
  lines: { catalogItemId: string; name: string; code: string | null; quantity: number; left: number }[];
  warnings: string[];
};

const FOLDER = "warranty-arrangement-files";
const MAX_DAYS = 10;
const inputCls = "bg-cloud border border-rule rounded px-2.5 py-1.5 text-[13px]";
const btnPrimary = "rounded border border-teal bg-teal px-3 py-1.5 text-[12px] font-bold text-navy cursor-pointer disabled:opacity-60";
const btnGhost = "rounded border border-rule px-3 py-1.5 text-[12px] font-semibold cursor-pointer disabled:opacity-60";

function statusOf(r: Row): { label: string; tone: string } {
  if (r.status === "REJECTED") return { label: "No aprobada por Bryan", tone: "text-red" };
  if (r.status === "CANCELLED") return { label: "Cancelada", tone: "text-steel" };
  if (r.shippedAt) return { label: "Salió en el corte", tone: "text-green" };
  if (r.status === "APPROVAL") return { label: "Esperando aprobación de Bryan", tone: "text-amber" };
  return r.guideNumber ? { label: "Aprobada · guía lista, sale en el próximo corte", tone: "text-blue" } : { label: "Aprobada · esperando que Dropi genere la guía", tone: "text-blue" };
}
const isOpen = (r: Row) => (r.status === "APPROVAL" || r.status === "APPROVED") && !r.shippedAt;

async function post(url: string, body: unknown): Promise<string | null> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (res.ok) return null;
  const d = await res.json().catch(() => null);
  return d?.error ?? "No se pudo guardar.";
}

// Garantías de Rocket enviadas como orden de Dropi (2026-10-16). Ver src/lib/rocketWarranty.ts.
export function RocketWarrantiesPanel() {
  const [role, setRole] = useState<Role | null>(null);
  const [reasons, setReasons] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [form, setForm] = useState(false);

  function load() {
    fetch("/api/rocket-warranties")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        setRole(d?.role ?? null);
        setReasons(d?.reasons ?? []);
        setRows(Array.isArray(d?.rows) ? d.rows : []);
      })
      .catch(() => setRows([]));
  }
  useEffect(load, []);

  if (rows === null || !role) return null;
  const open = rows.filter(isOpen);
  const closed = rows.filter((r) => !isOpen(r));

  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <div>
        <div className="font-display font-bold text-[16px]">Garantías de Rocket (por orden de Dropi)</div>
        <div className="text-[12px] text-steel mt-0.5">
          Rocket no genera guías de garantía: el reemplazo sale como una orden &quot;Sin Recaudo&quot; en Dropi. Yair la registra, Bryan la aprueba y DAFLOW encuentra sola la guía de esa orden. En el corte sale como garantía, no como pedido.
        </div>
      </div>
      {role.canCreate && (
        <button type="button" className={`self-start ${form ? btnPrimary : btnGhost}`} onClick={() => setForm(!form)}>
          Registrar garantía de Rocket
        </button>
      )}
      {form && <CreateForm reasons={reasons} onDone={() => { setForm(false); load(); }} />}
      <div>
        <div className="font-display font-bold text-[14px] mb-2.5">En curso ({open.length})</div>
        {open.length === 0 ? (
          <div className="text-[13px] text-steel">No hay garantías de Rocket en curso.</div>
        ) : (
          <div className="flex flex-col gap-2.5">{open.map((r) => <Card key={r.id} r={r} role={role} onChange={load} />)}</div>
        )}
      </div>
      {closed.length > 0 && (
        <div>
          <div className="font-display font-bold text-[14px] mb-2.5">Terminadas (últimos 60 días)</div>
          <div className="flex flex-col gap-2.5">{closed.map((r) => <Card key={r.id} r={r} role={role} onChange={load} />)}</div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11.5px] font-semibold text-steel">{label}</span>
      {children}
    </label>
  );
}

function EvidencePick({ files, onAdd, onRemove, onError }: { files: { url: string; name: string }[]; onAdd: (f: { url: string; name: string }) => void; onRemove: (i: number) => void; onError: (e: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const paste = usePasteFile((f) => void pick(f));
  async function pick(f: File | null | undefined) {
    if (!f) return;
    setBusy(true);
    const up = await uploadFile(f, FOLDER);
    setBusy(false);
    if (!up.ok) return onError(up.error);
    onAdd({ url: up.url, name: f.name });
  }
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11.5px] font-semibold text-steel">Fotos o capturas (opcional): el chat con Rocket o con el cliente</span>
      <input ref={ref} type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      {files.length < 6 && (
        <div
          tabIndex={0}
          role="button"
          onClick={() => ref.current?.click()}
          onPaste={paste.onPaste}
          onMouseEnter={paste.onMouseEnter}
          onMouseLeave={paste.onMouseLeave}
          onDragOver={paste.onDragOver}
          onDragLeave={paste.onDragLeave}
          onDrop={paste.onDrop}
          className={`flex items-center gap-1.5 self-start border-[1.5px] border-dashed rounded px-3 py-2 text-[12px] cursor-pointer hover:border-teal focus:border-teal focus:outline-none ${paste.isDragOver ? "border-teal bg-teal/10" : "border-rule"}`}
        >
          <Upload size={13} /> {busy ? "Subiendo…" : "Elegir, pegar (Ctrl+V) o arrastrar aquí"}
        </div>
      )}
      {files.map((f, i) => (
        <span key={f.url} className="text-[11.5px] text-green flex items-center gap-1">
          ✓ {f.name}
          <button type="button" className="text-steel hover:text-red cursor-pointer" onClick={() => onRemove(i)} aria-label="Quitar">
            <X size={12} />
          </button>
        </span>
      ))}
    </div>
  );
}

function CreateForm({ reasons, onDone }: { reasons: string[]; onDone: () => void }) {
  const [guide, setGuide] = useState("");
  const [found, setFound] = useState<Lookup | null>(null);
  const [searching, setSearching] = useState(false);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const [order, setOrder] = useState("");
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<{ url: string; name: string }[]>([]);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  async function search() {
    setErr("");
    setFound(null);
    setQty({});
    if (guide.trim().length < 5) return setErr("Escribe la guía de Rocket original.");
    setSearching(true);
    const res = await fetch(`/api/rocket-warranties?guide=${encodeURIComponent(guide.trim())}`);
    const d = await res.json().catch(() => null);
    setSearching(false);
    if (!res.ok) return setErr(d?.error ?? "No se encontró la guía.");
    setFound(d);
    if (d.lines?.length === 1 && d.lines[0].left > 0) setQty({ [d.lines[0].catalogItemId]: 1 });
  }

  async function send() {
    setErr("");
    if (!found) return setErr("Primero busca la guía de Rocket.");
    const items = Object.entries(qty).filter(([, q]) => q > 0).map(([catalogItemId, quantity]) => ({ catalogItemId, quantity }));
    if (items.length === 0) return setErr("Elige qué producto se reenvía y cuántas unidades.");
    if (!reason) return setErr("Elige el motivo.");
    if (order.replace(/\D/g, "").length < 5) return setErr("Escribe el número de orden de Dropi.");
    setSaving(true);
    const e = await post("/api/rocket-warranties", { originalGuide: found.guide, items, reason, dropiOrder: order, note: note.trim() || null, evidenceUrls: files.map((f) => f.url) });
    setSaving(false);
    if (e) return setErr(e);
    onDone();
  }

  const late = !!found && found.daysSince > MAX_DAYS;

  return (
    <div className="bg-surface border border-rule rounded-md p-4 flex flex-col gap-3">
      <div className="font-display font-bold text-[14px]">Registrar garantía de Rocket</div>
      <div className="flex gap-2 items-end">
        <Field label="Guía de Rocket original">
          <input value={guide} onChange={(e) => { setGuide(e.target.value); setFound(null); }} placeholder="Ej.: 186278520" className={`${inputCls} font-mono`} />
        </Field>
        <button type="button" disabled={searching} onClick={search} className={btnGhost}>{searching ? "Buscando…" : "Buscar"}</button>
      </div>
      {found && (
        <>
          <div className="text-[12.5px] bg-cloud rounded-md p-2.5">
            ✓ Salió en nuestros cortes hace {found.daysSince} día{found.daysSince === 1 ? "" : "s"} · <span className="font-semibold">{found.clientName ?? "Cliente sin nombre"}</span>
            {found.city ? ` · ${found.city}` : ""}
            {found.warnings.map((w) => (
              <div key={w} className="text-[11.5px] text-amber">{w}</div>
            ))}
          </div>
          {late ? (
            <div className="text-[12px] text-red font-semibold">Ya pasaron más de {MAX_DAYS} días desde que se despachó el pedido: no se puede hacer la garantía.</div>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <span className="text-[11.5px] font-semibold text-steel">¿Qué se reenvía? (unidades)</span>
                {found.lines.map((l) => (
                  <div key={l.catalogItemId} className="flex items-center gap-2 text-[12.5px]">
                    <input
                      type="number"
                      min={0}
                      max={l.left}
                      disabled={l.left === 0}
                      value={qty[l.catalogItemId] ?? 0}
                      onChange={(e) => setQty((p) => ({ ...p, [l.catalogItemId]: Math.max(0, Math.min(l.left, Math.floor(Number(e.target.value) || 0))) }))}
                      className={`${inputCls} w-16 text-center`}
                    />
                    <span className="flex-1">{l.name}</span>
                    <span className="text-[11px] text-steel">{l.left === 0 ? "ya se usó en otra garantía" : `la guía llevaba ${l.quantity}${l.left < l.quantity ? `, quedan ${l.left}` : ""}`}</span>
                  </div>
                ))}
              </div>
              <Field label="Motivo">
                <select value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls}>
                  <option value="">Elegir…</option>
                  {reasons.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </Field>
              <Field label="Número de orden de Dropi de la garantía">
                <input value={order} onChange={(e) => setOrder(e.target.value)} inputMode="numeric" placeholder="Ej.: 7501714" className={`${inputCls} font-mono`} />
              </Field>
              <Field label="Detalle (opcional)">
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Ej.: le faltó la funda; Rocket confirmó por chat." className={inputCls} />
              </Field>
              <EvidencePick files={files} onAdd={(f) => setFiles((p) => [...p, f])} onRemove={(i) => setFiles((p) => p.filter((_, idx) => idx !== i))} onError={setErr} />
            </>
          )}
        </>
      )}
      {err && <div className="text-red text-[11.5px]">{err}</div>}
      {found && !late && (
        <button type="button" disabled={saving} onClick={send} className={`self-start ${btnPrimary}`}>{saving ? "Enviando…" : "Enviar a Bryan para aprobar"}</button>
      )}
    </div>
  );
}

function Card({ r, role, onChange }: { r: Row; role: Role; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [text, setText] = useState("");
  const st = statusOf(r);
  const mine = r.createdById === role.userId;

  async function act(body: Record<string, unknown>, confirmMsg?: string) {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setErr("");
    setBusy(true);
    const e = await post(`/api/rocket-warranties/${r.id}`, body);
    setBusy(false);
    if (e) return setErr(e);
    setText("");
    onChange();
  }

  return (
    <div className="bg-surface border border-rule rounded-md p-3.5 flex flex-col gap-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono text-[13px] font-bold text-teal">{r.code}</span>
        <span className={`text-[11.5px] font-semibold ${st.tone}`}>{st.label}</span>
      </div>
      <div className="text-[12px]">
        Guía Rocket <span className="font-mono">{r.originalGuide}</span>
        {r.clientName ? ` · ${r.clientName}` : ""}
        {r.city ? ` · ${r.city}` : ""}
      </div>
      <div className="text-[12px]">
        {r.items.map((i) => `${i.quantity} ${i.name}`).join(", ")} · <span className="font-semibold">{r.reason}</span>
      </div>
      <div className="text-[12px]">
        Orden Dropi <span className="font-mono">{r.dropiOrder}</span>
        {r.dropiAccount ? ` (${r.dropiAccount})` : ""}
        {r.guideNumber ? (
          <>
            {" "}· guía <span className="font-mono font-semibold">{r.guideNumber}</span>
            {r.guideLinkedByName ? <span className="text-steel"> · unida por {r.guideLinkedByName}</span> : null}
          </>
        ) : (
          <span className="text-steel"> · sin guía todavía</span>
        )}
      </div>
      {r.note && <div className="text-[12.5px] whitespace-pre-wrap bg-cloud rounded-md p-2.5">{r.note}</div>}
      {r.evidenceUrls.length > 0 && (
        <div className="flex gap-3 flex-wrap">
          {r.evidenceUrls.map((u, i) => (
            <a key={u} href={u} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[11.5px] font-semibold text-blue">
              <FileText size={12} /> Evidencia {i + 1}
            </a>
          ))}
        </div>
      )}
      <div className="text-[11px] text-steel">
        Registrada por {r.createdByName} · {formatDateTime(r.createdAt)}
        {r.reviewedAt && ` · revisada por ${r.reviewedByName} · ${formatDateTime(r.reviewedAt)}`}
        {r.shippedAt && ` · salió ${formatDateTime(r.shippedAt)}`}
      </div>
      {r.reviewNote && <div className="text-[12px] text-red">Motivo: {r.reviewNote}</div>}

      {r.status === "APPROVAL" && role.canApprove && (
        <div className="flex flex-col gap-2 mt-1">
          <button type="button" disabled={busy} className={`self-start ${btnPrimary}`} onClick={() => act({ action: "approve" }, `¿Apruebas la garantía ${r.code}?`)}>Aprobar</button>
          {!r.shippedAt && (
            <div className="flex gap-2">
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Si no la apruebas, escribe por qué" className={`${inputCls} flex-1`} />
              <button type="button" disabled={busy || text.trim().length < 3} className={btnGhost} onClick={() => act({ action: "reject", note: text })}>No aprobar</button>
            </div>
          )}
        </div>
      )}
      {r.status === "REJECTED" && mine && <div className="text-[12px] font-semibold text-red">Cancela la orden {r.dropiOrder} en Dropi para que no salga.</div>}
      {(mine || role.isAdmin) && isOpen(r) && (
        <button type="button" disabled={busy} className="self-start text-[11px] text-red cursor-pointer disabled:opacity-60" onClick={() => act({ action: "cancel" }, "¿Cancelar esta garantía? Recuerda cancelar también la orden en Dropi.")}>Cancelar</button>
      )}
      {err && <div className="text-red text-[11.5px]">{err}</div>}
    </div>
  );
}
