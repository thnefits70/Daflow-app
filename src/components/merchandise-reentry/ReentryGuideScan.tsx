"use client";

import { useRef, useState } from "react";
import { AlertTriangle, Camera, Check, Keyboard, Loader2, X } from "lucide-react";
import { LiveBarcodeScanner } from "@/components/shared/LiveBarcodeScanner";
import { CatalogCode } from "@/components/shared/CatalogCode";
import { ExpandableName } from "@/components/ui/ExpandableName";
import { playSound } from "@/lib/sound";

// Pedido del usuario 2026-10-02: el reingreso se hace escaneando la guía de
// cada devolución, una tras otra, sin revisar nada por guía. DAFLOW agrega
// solo los productos de esa guía al lote. Escribir el número a mano solo si
// la etiqueta no se puede leer (dos veces, tienen que coincidir). Si la guía
// no sirve, se muestra la razón y, solo cuando corresponde, se habilita el
// registro a mano de esa devolución.

export type ScanGuideDTO = { id: string; guideNumber: string; carrier: string; shippedDay: string | null; warnings: string[]; createdAt: string };
export type ScanItemDTO = {
  id: string;
  guideId: string | null;
  scanDamage: boolean;
  manualReason: string | null;
  catalogItemId: string | null;
  catalogItem: { name: string; photos: string[]; justCode: string | null } | null;
  declaredName: string | null;
  goodQty: number;
  damagedQty: number;
  damageReason: { name: string } | null;
  damageReasonOther: string | null;
};

type ScanResponse = { ok: true; guideNumber: string; units: number; warnings: string[] } | { ok: false; reason: string; allowManual: boolean };
type Feedback = { kind: "ok" | "fail" | "info"; text: string; warnings?: string[]; allowManual?: boolean; raw?: string };

const DAMAGE_REASONS = ["Producto roto", "Empaque abierto", "Humedad/manchado", "Golpeado", "Otro"];
// Una pistola lectora "escribe" el número completo en milisegundos; si tardó
// más que esto, lo escribió una persona.
const PISTOL_MAX_MS = 1200;
const nowMs = () => Date.now();

const CARRIER_LABEL: Record<string, string> = { SERVIENTREGA: "Servientrega", GINTRACOM: "Gintracom", LAAR: "Laar", URBANO: "Urbano", VELOCES: "Veloces" };

export function GuideScanner({ batchId, onChanged, onManual }: { batchId: string; onChanged: () => void; onManual: (reason: string) => void }) {
  const [cameraOn, setCameraOn] = useState(false);
  // Cola de guías por leer: la cámara sigue escaneando mientras DAFLOW lee
  // la anterior (cada lectura abre el PDF del corte y tarda unos segundos).
  const queueRef = useRef<string[]>([]);
  const runningRef = useRef(false);
  const [pending, setPending] = useState(0);
  const [feedback, setFeedbackState] = useState<Feedback | null>(null);
  const [typing, setTyping] = useState(false);
  // 2026-10-03: si la guía no sirve (ya escaneada, no encontrada…) suena el
  // sonido de error, distinto al bip de "leído", para notarlo sin mirar.
  const setFeedback = (fb: Feedback | null) => {
    if (fb?.kind === "fail") playSound("error");
    setFeedbackState(fb);
  };
  // Guías ya leídas en esta pantalla: si la cámara se queda sobre la misma
  // guía y la vuelve a leer, se ignora en silencio (antes, pasados 8 s, salía
  // el aviso rojo "Ya escaneaste…" con sonido de error — reporte de Joel
  // 2026-10-03).
  const seen = useRef<Set<string>>(new Set());

  // Pistola lectora (escribe como un teclado y termina con Enter).
  const [pistol, setPistol] = useState("");
  const pistolStart = useRef<number | null>(null);

  function enqueue(raw: string) {
    const key = raw.trim().toUpperCase();
    if (!key) return;
    if (seen.current.has(key)) return;
    seen.current.add(key);
    queueRef.current.push(key);
    setPending(queueRef.current.length);
    processNext();
  }

  function processNext() {
    if (runningRef.current) return;
    const raw = queueRef.current[0];
    if (!raw) return;
    runningRef.current = true;
    fetch(`/api/merchandise-reentry/batches/${batchId}/guides`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw, typedByHand: false }),
    })
      .then(async (r) => {
        const data = (await r.json().catch(() => null)) as (ScanResponse & { error?: string }) | null;
        if (!r.ok || !data) setFeedback({ kind: "fail", text: data?.error ?? "No se pudo registrar la guía. Vuelve a escanearla." });
        else if (data.ok) setFeedback({ kind: "ok", text: `Guía ${data.guideNumber} · ${data.units} unidad(es)`, warnings: data.warnings });
        // Ya estaba en el lote (escaneada antes de recargar la página): no es
        // un error, solo se avisa en gris y sin sonido de error.
        else if (data.reason.startsWith("Ya escaneaste")) setFeedback({ kind: "info", text: `Guía ${raw} ya estaba en este lote — sigue con la siguiente.` });
        else setFeedback({ kind: "fail", text: data.reason, allowManual: data.allowManual, raw });
        if (data?.ok) onChanged();
      })
      .catch(() => {
        // Se puede volver a escanear la misma guía.
        seen.current.delete(raw);
        setFeedback({ kind: "fail", text: "Sin conexión. Vuelve a escanear la guía." });
      })
      .finally(() => {
        queueRef.current.shift();
        setPending(queueRef.current.length);
        runningRef.current = false;
        processNext();
      });
  }

  return (
    <div className="bg-surface border border-teal/40 rounded-md p-3.5 mb-3">
      <div className="font-display font-bold text-[14px] mb-1">Paso 1 · Escanea la guía de cada devolución</div>
      <p className="text-[11.5px] text-steel mb-3">
        Una tras otra, sin revisar nada. DAFLOW agrega solo los productos que traía cada guía.
      </p>

      {cameraOn ? (
        <div className="mb-2.5">
          {/* 2026-10-03: la cámara queda abierta entre guía y guía. */}
          <LiveBarcodeScanner continuous onScanned={enqueue} onCancel={() => setCameraOn(false)} />
          <button type="button" className="mt-2 text-[12px] font-semibold text-steel cursor-pointer" onClick={() => setCameraOn(false)}>
            Cerrar cámara
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="w-full flex items-center justify-center gap-1.5 rounded border border-teal bg-teal px-3.5 py-2.5 text-[13px] font-bold text-navy cursor-pointer mb-2.5"
          onClick={() => setCameraOn(true)}
        >
          <Camera size={15} /> Escanear guías con la cámara
        </button>
      )}

      <input
        type="text"
        inputMode="none"
        autoComplete="off"
        placeholder="…o dispara aquí la pistola lectora"
        className="w-full rounded border border-rule bg-cloud px-2.5 py-2 text-[12.5px] font-mono"
        value={pistol}
        onChange={(e) => {
          if (pistolStart.current === null) pistolStart.current = nowMs();
          setPistol(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          const elapsed = pistolStart.current === null ? 0 : nowMs() - pistolStart.current;
          const value = pistol;
          setPistol("");
          pistolStart.current = null;
          if (!value.trim()) return;
          if (elapsed > PISTOL_MAX_MS) {
            setFeedback({ kind: "fail", text: "Eso parece escrito a mano. Escanea la guía; si la etiqueta no se puede leer, usa \"La etiqueta no se puede leer\"." });
            return;
          }
          playSound("scan");
          enqueue(value);
        }}
      />

      {pending > 0 && (
        <div className="flex items-center gap-1.5 text-[12px] text-steel mt-2.5">
          <Loader2 size={13} className="animate-spin" /> Leyendo {pending} guía(s)…
        </div>
      )}

      {feedback && (
        <div className={`mt-2.5 rounded-md border p-2.5 text-[12px] ${feedback.kind === "ok" ? "border-green/40 bg-green/10" : feedback.kind === "info" ? "border-rule bg-cloud" : "border-red/40 bg-red/10"}`}>
          <div className="flex items-start gap-1.5">
            {feedback.kind === "fail" ? <AlertTriangle size={14} className="text-red mt-0.5 shrink-0" /> : <Check size={14} className={`${feedback.kind === "ok" ? "text-green" : "text-steel"} mt-0.5 shrink-0`} />}
            <span className="font-semibold">{feedback.text}</span>
          </div>
          {feedback.warnings?.map((w) => (
            <div key={w} className="text-[11px] text-steel mt-1 pl-5">⚠ {w}</div>
          ))}
          {feedback.kind === "fail" && feedback.allowManual && (
            <button
              type="button"
              className="mt-2 ml-5 rounded border border-rule bg-surface px-2.5 py-1.5 text-[11.5px] font-semibold cursor-pointer"
              onClick={() => onManual(`${feedback.text}${feedback.raw ? ` (leído: ${feedback.raw})` : ""}`)}
            >
              Registrar esta devolución a mano
            </button>
          )}
        </div>
      )}

      {typing ? (
        <TypedGuideForm
          batchId={batchId}
          onDone={(fb) => {
            setTyping(false);
            setFeedback(fb);
            if (fb.kind === "ok") onChanged();
          }}
          onCancel={() => setTyping(false)}
        />
      ) : (
        <button type="button" className="mt-2.5 flex items-center gap-1 text-[11.5px] text-steel underline cursor-pointer" onClick={() => setTyping(true)}>
          <Keyboard size={12} /> La etiqueta no se puede leer
        </button>
      )}
    </div>
  );
}

// Solo si la etiqueta está rota o mojada: el número se escribe dos veces y
// tiene que coincidir, para evitar un error al tipear.
function TypedGuideForm({ batchId, onDone, onCancel }: { batchId: string; onDone: (fb: Feedback) => void; onCancel: () => void }) {
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const [saving, setSaving] = useState(false);
  const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const match = norm(first).length >= 8 && norm(first) === norm(second);

  async function send() {
    setSaving(true);
    const raw = norm(first);
    try {
      const r = await fetch(`/api/merchandise-reentry/batches/${batchId}/guides`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raw, typedByHand: true }),
      });
      const data = (await r.json().catch(() => null)) as (ScanResponse & { error?: string }) | null;
      if (!r.ok || !data) onDone({ kind: "fail", text: data?.error ?? "No se pudo registrar la guía." });
      else if (data.ok) onDone({ kind: "ok", text: `Guía ${data.guideNumber} · ${data.units} unidad(es)`, warnings: data.warnings });
      else onDone({ kind: "fail", text: data.reason, allowManual: data.allowManual, raw });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-2.5 rounded-md border border-gold/50 bg-gold/10 p-3">
      <div className="text-[12px] font-semibold mb-2">Escribe el número de guía dos veces</div>
      <input className="w-full rounded border border-rule bg-surface px-2.5 py-1.5 text-[13px] font-mono mb-1.5" placeholder="Número de guía" value={first} onChange={(e) => setFirst(e.target.value)} />
      <input className="w-full rounded border border-rule bg-surface px-2.5 py-1.5 text-[13px] font-mono" placeholder="Repite el número" value={second} onChange={(e) => setSecond(e.target.value)} onPaste={(e) => e.preventDefault()} />
      {second && !match && <div className="text-red text-[11px] mt-1">Los dos números no coinciden.</div>}
      <div className="flex gap-2 mt-2.5">
        <button type="button" className="flex-1 rounded border border-rule px-3 py-1.5 text-[12px] font-semibold cursor-pointer" onClick={onCancel}>
          Cancelar
        </button>
        <button type="button" disabled={!match || saving} className="flex-1 rounded border border-teal bg-teal px-3 py-1.5 text-[12px] font-bold text-navy cursor-pointer disabled:opacity-40" onClick={send}>
          {saving ? "Buscando…" : "Buscar guía"}
        </button>
      </div>
    </div>
  );
}

export function ScannedGuidesList({ guides, items, onChanged }: { guides: ScanGuideDTO[]; items: ScanItemDTO[]; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  if (guides.length === 0) return null;
  const unitsOf = (gid: string) => items.filter((i) => i.guideId === gid).reduce((s, i) => s + i.goodQty, 0);
  const withWarnings = guides.filter((g) => g.warnings.length > 0).length;

  async function remove(id: string) {
    await fetch(`/api/merchandise-reentry/guides/${id}`, { method: "DELETE" });
    setRemoving(null);
    onChanged();
  }

  return (
    <div className="bg-surface border border-rule rounded-md p-3 mb-3">
      <button type="button" className="w-full flex items-center justify-between text-[12.5px] font-semibold cursor-pointer" onClick={() => setOpen((o) => !o)}>
        <span>
          {guides.length} guía(s) escaneada(s)
          {withWarnings > 0 && <span className="text-gold"> · {withWarnings} con aviso</span>}
        </span>
        <span className="text-[11px] text-blue">{open ? "Ocultar" : "Ver"}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-1.5 mt-2.5">
          {guides.map((g) => (
            <div key={g.id} className="border-t border-rule pt-1.5">
              <div className="flex items-center gap-2 text-[12px]">
                <span className="font-mono font-semibold">{g.guideNumber}</span>
                <span className="text-steel text-[11px]">{CARRIER_LABEL[g.carrier] ?? g.carrier}{g.shippedDay ? ` · salió ${g.shippedDay.slice(8, 10)}/${g.shippedDay.slice(5, 7)}` : ""}</span>
                <span className="ml-auto text-[13px] font-bold tabular-nums">
                  {unitsOf(g.id)} <span className="text-[11px] font-medium text-steel">un.</span>
                </span>
                {removing === g.id ? (
                  <span className="flex items-center gap-1.5">
                    <button type="button" className="text-red text-[11px] font-bold cursor-pointer" onClick={() => remove(g.id)}>Quitar</button>
                    <button type="button" className="text-steel text-[11px] cursor-pointer" onClick={() => setRemoving(null)}>No</button>
                  </span>
                ) : (
                  <button type="button" title="Quitar esta guía del lote" className="text-steel hover:text-red cursor-pointer" onClick={() => setRemoving(g.id)}>
                    <X size={13} />
                  </button>
                )}
              </div>
              {g.warnings.map((w) => (
                <div key={w} className="text-[10.5px] text-steel mt-0.5">⚠ {w}</div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Productos que trajeron las guías del lote, sumados. Joel toca solo los que
// vinieron dañados; todo lo demás se toma como bueno.
// Pedido del usuario 2026-10-02: Joel recién sabe qué vino dañado después
// de escanear todo y apartar físicamente lo dañado. Por eso la lista queda
// cerrada: si no hubo nada dañado, envía directo; si hubo, la abre y marca
// solo esos productos con su cantidad.
export function ScannedProductsDamage({ batchId, items, onChanged }: { batchId: string; items: ScanItemDTO[]; onChanged: () => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const products = new Map<string, { id: string; name: string; photo: string | null; code: string | null; units: number; damaged: number; reason: string | null }>();
  for (const i of items) {
    if (!i.catalogItemId || !(i.guideId || i.scanDamage)) continue;
    const p = products.get(i.catalogItemId) ?? { id: i.catalogItemId, name: i.catalogItem?.name ?? "Producto", photo: i.catalogItem?.photos[0] ?? null, code: i.catalogItem?.justCode ?? null, units: 0, damaged: 0, reason: null };
    if (i.scanDamage) {
      p.damaged += i.damagedQty;
      p.reason = i.damageReason?.name ?? i.damageReasonOther ?? null;
    } else p.units += i.goodQty;
    products.set(i.catalogItemId, p);
  }
  const unidentified = items.filter((i) => i.guideId && !i.catalogItemId);
  if (products.size === 0 && unidentified.length === 0) return null;
  const list = [...products.values()].sort((a, b) => a.name.localeCompare(b.name));
  const totalUnits = list.reduce((s, p) => s + p.units, 0);
  const totalDamaged = list.reduce((s, p) => s + p.damaged, 0);
  // Pedido del usuario 2026-10-02: la lista se puede volver a ocultar con
  // "Ocultar" (como la de guías escaneadas), aunque ya haya dañadas marcadas.
  const showList = open;

  return (
    <div className="bg-surface border border-rule rounded-md p-3 mb-3">
      <div className="flex items-center justify-between gap-2 mb-0.5">
        <div className="font-display font-bold text-[14px]">Paso 2 · ¿Vino algo dañado?</div>
        {showList && (
          <button
            type="button"
            className="text-[11px] font-semibold text-blue cursor-pointer"
            onClick={() => {
              setOpen(false);
              setEditing(null);
            }}
          >
            Ocultar
          </button>
        )}
      </div>
      <div className="text-[11px] text-steel mb-2.5">
        {list.length} producto(s) · <span className="text-green font-bold">{totalUnits - totalDamaged} buenas</span>
        {totalDamaged > 0 && <span className="text-red font-bold"> · {totalDamaged} dañadas</span>}
        {!showList && totalDamaged === 0 && " · Si no vino nada dañado, envía el lote directo."}
      </div>
      {!showList && (
        <button type="button" className="w-full rounded border border-red/50 px-3 py-2 text-[12.5px] font-semibold text-red cursor-pointer" onClick={() => setOpen(true)}>
          {totalDamaged > 0 ? "Ver o cambiar productos dañados" : "Sí, marcar productos dañados"}
        </button>
      )}
      {showList && <div className="text-[11px] text-steel mb-2">Toca cada producto que apartaste como dañado y pon cuántos. Lo demás queda como bueno.</div>}
      <div className={`flex flex-col gap-1.5 ${showList ? "" : "hidden"}`}>
        {list.map((p) => (
          <div key={p.id} className={`rounded-md border p-2 ${p.damaged > 0 ? "border-red/40 bg-red/5" : "border-rule"}`}>
            <button type="button" className="w-full flex items-center gap-2.5 text-left cursor-pointer" onClick={() => setEditing(editing === p.id ? null : p.id)}>
              {p.photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.photo} alt={p.name} className="w-11 h-11 object-cover rounded border border-rule shrink-0" />
              ) : (
                <div className="w-11 h-11 rounded border border-rule bg-cloud shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-[12.5px] font-semibold flex items-center gap-1.5 min-w-0">
                  <CatalogCode code={p.code} />
                  <ExpandableName text={p.name} />
                </div>
                <div className="text-[11px] text-steel mt-0.5">
                  <span className="text-[14px] font-bold text-ink tabular-nums">{p.units}</span> un.
                  {p.damaged > 0 && (
                    <span className="text-red font-semibold">
                      {" · "}
                      <span className="text-[14px] font-bold tabular-nums">{p.damaged}</span> dañada(s){p.reason ? ` (${p.reason})` : ""}
                    </span>
                  )}
                </div>
              </div>
            </button>
            {editing === p.id && (
              <DamageEditor
                batchId={batchId}
                catalogItemId={p.id}
                max={p.units}
                current={p.damaged}
                onSaved={() => {
                  setEditing(null);
                  onChanged();
                }}
                onCancel={() => setEditing(null)}
              />
            )}
          </div>
        ))}
        {unidentified.map((i) => (
          <div key={i.id} className="rounded-md border border-gold/50 bg-gold/10 p-2 text-[12px]">
            <span className="font-semibold">{i.declaredName}</span> · {i.goodQty} un.
            <div className="text-[11px] text-steel">Este código no está vinculado a un producto de INVESTOCK — Daniel lo identifica al revisar.</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DamageEditor({ batchId, catalogItemId, max, current, onSaved, onCancel }: { batchId: string; catalogItemId: string; max: number; current: number; onSaved: () => void; onCancel: () => void }) {
  const [qty, setQty] = useState(current > 0 ? String(current) : "");
  const [reason, setReason] = useState("");
  const [other, setOther] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const n = Number(qty) || 0;
  const valid = n >= 0 && n <= max && (n === 0 || (!!reason && (reason !== "Otro" || !!other.trim())));

  async function save() {
    setSaving(true);
    setError("");
    try {
      const r = await fetch(`/api/merchandise-reentry/batches/${batchId}/damage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          catalogItemId,
          damagedQty: n,
          damageReasonName: n > 0 && reason !== "Otro" ? reason : undefined,
          damageReasonOther: n > 0 && reason === "Otro" ? other.trim() : undefined,
        }),
      });
      const data = await r.json().catch(() => null);
      if (!r.ok) throw new Error(data?.error ?? "No se pudo guardar.");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-2 border-t border-rule pt-2">
      <div className="text-[11px] text-steel mb-1">¿Cuántas vinieron dañadas? (de {max})</div>
      <input type="number" min={0} max={max} className="w-24 rounded border border-rule bg-cloud px-2.5 py-1.5 text-[13px] font-bold text-red" value={qty} onChange={(e) => setQty(e.target.value)} />
      {n > 0 && (
        <div className="mt-2">
          <div className="text-[11px] text-steel mb-1">Motivo</div>
          <div className="flex gap-1.5 flex-wrap">
            {DAMAGE_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setReason(r)}
                className={`text-[11.5px] font-semibold rounded-full px-2.5 py-1 border cursor-pointer ${reason === r ? "border-teal text-teal bg-teal/15" : "border-rule text-steel"}`}
              >
                {r}
              </button>
            ))}
          </div>
          {reason === "Otro" && (
            <input type="text" placeholder="Describe el motivo (ej. no vino)" className="w-full mt-1.5 rounded border border-rule bg-cloud px-2.5 py-1.5 text-[12px]" value={other} onChange={(e) => setOther(e.target.value)} />
          )}
        </div>
      )}
      {n > max && <div className="text-red text-[11px] mt-1">Solo llegaron {max}.</div>}
      {error && <div className="text-red text-[11px] mt-1">{error}</div>}
      <div className="flex gap-2 mt-2">
        <button type="button" className="flex-1 rounded border border-rule px-3 py-1.5 text-[12px] font-semibold cursor-pointer" onClick={onCancel}>
          Cancelar
        </button>
        <button type="button" disabled={!valid || saving} className="flex-1 rounded border border-red bg-red px-3 py-1.5 text-[12px] font-bold text-white cursor-pointer disabled:opacity-40" onClick={save}>
          {saving ? "Guardando…" : n === 0 ? "Quitar dañadas" : "Guardar dañadas"}
        </button>
      </div>
    </div>
  );
}
