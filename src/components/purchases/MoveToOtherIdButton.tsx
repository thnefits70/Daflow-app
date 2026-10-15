"use client";

import { useRef, useState } from "react";
import { Upload, X } from "lucide-react";
import { uploadFile } from "@/lib/uploadFile";
import { compressImage } from "@/lib/compressImage";
import { useB2BAdvisorLabel } from "@/lib/useB2BAdvisorLabel";

// Pedido de Bryan Ríos 2026-10-15 (caso SC-181, chalecos de CHEN): si lo que
// se compró es otro modelo, la compra pasa a otro ID antes de entrar al stock
// — así no se mezcla en bodega. Dos caminos:
// - Modelo nuevo (lo normal): solo nombre y fotos. Queda como producto nuevo
//   de Análisis de Mercado: la asesora B2B lo publica en Dropi y pone el ID,
//   Bryan lo libera al Kardex.
// - Ya existe en DAFLOW: se escribe su ID y la compra pasa a ese producto.
// Ver lib/purchaseMoveToOtherId.ts.
type Lookup = {
  existing: { id: string; name: string; justCode: string | null; photo: string | null; isSame: boolean } | null;
  receiptPhotos: string[];
};

export function MoveToOtherIdButton({ requestId, itemName, onMoved }: { requestId: string; itemName: string; onMoved: () => void }) {
  const b2b = useB2BAdvisorLabel();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [justCode, setJustCode] = useState("");
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [looking, setLooking] = useState(false);
  const [name, setName] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [hasVariants, setHasVariants] = useState<boolean | null>(null);
  const [variantNotes, setVariantNotes] = useState("");
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [confirming, setConfirming] = useState(false);
  const lookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lookupSeq = useRef(0);

  function fetchLookup(code: string, seq: number) {
    fetch(`/api/purchase-requests/${requestId}/move-to-other-id?justCode=${encodeURIComponent(code)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Lookup | null) => {
        if (seq !== lookupSeq.current) return;
        setLookup(data);
      })
      .finally(() => {
        if (seq === lookupSeq.current) setLooking(false);
      });
  }

  function openPanel() {
    setOpen(true);
    // Las fotos de lo que llegó sirven de punto de partida para el modelo nuevo.
    fetch(`/api/purchase-requests/${requestId}/move-to-other-id`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Lookup | null) => {
        if (data) setPhotos((p) => (p.length > 0 ? p : data.receiptPhotos.slice(0, 3)));
      })
      .catch(() => {});
  }

  function changeJustCode(value: string) {
    setJustCode(value);
    setConfirming(false);
    if (lookupTimer.current) clearTimeout(lookupTimer.current);
    const code = value.trim();
    const seq = ++lookupSeq.current;
    if (!code) {
      setLookup(null);
      setLooking(false);
      return;
    }
    setLooking(true);
    lookupTimer.current = setTimeout(() => fetchLookup(code, seq), 400);
  }

  function close() {
    if (lookupTimer.current) clearTimeout(lookupTimer.current);
    lookupSeq.current++;
    setOpen(false);
    setMode("new");
    setJustCode("");
    setLookup(null);
    setName("");
    setPhotos([]);
    setHasVariants(null);
    setVariantNotes("");
    setErr("");
    setConfirming(false);
  }

  async function addPhotos(files: FileList | null) {
    if (!files) return;
    const toAdd = Array.from(files).filter((f) => f.type.startsWith("image/")).slice(0, Math.max(0, 3 - photos.length));
    setUploading(true);
    setErr("");
    for (const f of toAdd) {
      const res = await uploadFile(await compressImage(f), "purchase-catalog");
      if (!res.ok) {
        setErr(res.error);
        break;
      }
      setPhotos((p) => [...p, res.url].slice(0, 3));
    }
    setUploading(false);
  }

  async function move() {
    setBusy(true);
    setErr("");
    const body = mode === "existing" ? { existingCatalogItemId: lookup?.existing?.id } : { newItem: { name: name.trim(), photos, hasVariants, variantNotes: hasVariants ? variantNotes.trim() : undefined } };
    const res = await fetch(`/api/purchase-requests/${requestId}/move-to-other-id`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      setConfirming(false);
      setErr(data?.error ?? "No se pudo pasar a otro ID.");
      return;
    }
    close();
    onMoved();
  }

  if (!open) {
    return (
      <button type="button" className="text-[11.5px] font-semibold border border-blue/50 text-blue rounded px-3 py-1.5 cursor-pointer" onClick={openPanel}>
        Es otro modelo → pasar a otro ID
      </button>
    );
  }

  const existing = lookup?.existing ?? null;
  const canSubmit =
    !busy &&
    !uploading &&
    (mode === "existing" ? !!existing && !existing.isSame && !looking : name.trim().length >= 3 && photos.length >= 3 && hasVariants !== null && (!hasVariants || variantNotes.trim().length > 0));
  const targetLabel = mode === "existing" && existing ? `${existing.name} (${existing.justCode})` : `${name.trim()} (modelo nuevo)`;
  const tab = (m: "new" | "existing", label: string) => (
    <button
      type="button"
      className={`rounded border px-2.5 py-1 text-[11.5px] font-semibold cursor-pointer ${mode === m ? "border-blue bg-blue/15 text-blue" : "border-rule text-steel"}`}
      onClick={() => { setMode(m); setConfirming(false); setErr(""); }}
    >
      {label}
    </button>
  );

  return (
    <div className="bg-cloud border border-blue/35 rounded-md p-3 my-2 text-[12.5px]">
      <div className="font-bold mb-1">Pasar a otro ID</div>
      <div className="text-steel text-[11.5px] mb-2.5">
        Lo que se compró como <b>{itemName}</b> es otro modelo. Pásalo a su propio producto para que no se mezcle en bodega.
      </div>
      <div className="flex gap-2 mb-2.5 flex-wrap">
        {tab("new", "Es un modelo nuevo")}
        {tab("existing", "Ya existe con su ID")}
      </div>

      {mode === "new" ? (
        <div className="mb-2.5">
          <div className="text-[11.5px] text-steel mb-2">
            No necesitas el ID: {b2b.the} lo publica en Dropi y pone el ID, y después Bryan lo libera al Kardex — igual que cualquier producto nuevo. Mientras tanto Daniel puede aprobar la llegada y no suma a ningún stock.
          </div>
          <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Nombre del modelo nuevo</label>
          <input
            className="w-full rounded border border-rule px-2.5 py-2 text-[13px] mb-2"
            value={name}
            onChange={(e) => { setName(e.target.value); setConfirming(false); }}
            placeholder={`Ej. ${itemName} — modelo 2`}
          />
          <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Fotos del modelo nuevo ({photos.length}/3, mínimo 3)</label>
          <div className="flex gap-2 flex-wrap mb-1">
            {photos.map((p, i) => (
              <div key={p} className="relative">
                <img loading="lazy" decoding="async" src={p} alt="" className="w-16 h-16 rounded object-cover border border-rule" />
                <button
                  type="button"
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red text-white flex items-center justify-center cursor-pointer"
                  onClick={() => setPhotos((ps) => ps.filter((_, j) => j !== i))}
                >
                  <X size={11} />
                </button>
              </div>
            ))}
            {photos.length < 3 && (
              <label className="w-16 h-16 rounded border-[1.5px] border-dashed border-rule flex items-center justify-center cursor-pointer hover:border-teal">
                {uploading ? <span className="text-[10px] text-steel">Subiendo…</span> : <Upload size={16} className="text-steel" />}
                <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { addPhotos(e.target.files); e.target.value = ""; }} />
              </label>
            )}
          </div>
          <div className="text-[10.5px] text-steel-dim mb-2">Si ya llegó, se ponen solas las fotos de lo que llegó; puedes cambiarlas.</div>
          {/* Caso AM-0052: misma pregunta que en Proponer, para que la asesora B2B sepa cómo crear el ID. */}
          <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">¿Lleva variantes (tallas, colores)?</label>
          <div className="flex gap-1.5 mb-1" style={{ maxWidth: 220 }}>
            {([true, false] as const).map((v) => (
              <button
                key={String(v)}
                type="button"
                className={`flex-1 rounded border py-1.5 text-[12px] font-semibold cursor-pointer ${hasVariants === v ? "border-blue bg-blue/15 text-blue" : "border-rule text-steel"}`}
                onClick={() => { setHasVariants(v); setConfirming(false); }}
              >
                {v ? "Sí" : "No"}
              </button>
            ))}
          </div>
          {hasVariants && (
            <textarea
              className="w-full rounded border border-rule px-2.5 py-1.5 text-[13px] mt-1"
              rows={2}
              placeholder="Ej. tallas S, M, L, XL · 1 color"
              value={variantNotes}
              onChange={(e) => { setVariantNotes(e.target.value); setConfirming(false); }}
            />
          )}
        </div>
      ) : (
        <div className="mb-2.5">
          <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">ID del producto correcto</label>
          <input
            className="w-full rounded border border-rule px-2.5 py-2 text-[13px] font-mono mb-2"
            style={{ maxWidth: 220 }}
            value={justCode}
            onChange={(e) => changeJustCode(e.target.value)}
            placeholder="Ej. 195872"
            inputMode="numeric"
          />
          {justCode.trim() && looking && <div className="text-steel text-[11.5px]">Buscando…</div>}
          {justCode.trim() && !looking && existing && (
            <div className={`flex items-center gap-2 ${existing.isSame ? "text-red" : ""}`}>
              {existing.photo && <img loading="lazy" decoding="async" src={existing.photo} alt="" className="w-10 h-10 rounded object-cover border border-rule" />}
              <span>{existing.isSame ? "Ese es el mismo ID de esta compra — escribe el del modelo correcto." : <>La compra pasará a <b>{existing.name}</b>.</>}</span>
            </div>
          )}
          {justCode.trim() && !looking && lookup && !existing && (
            <div className="text-[11.5px] text-red">Ese ID no está en DAFLOW. Si es un modelo que todavía no tenemos, usa &quot;Es un modelo nuevo&quot;.</div>
          )}
        </div>
      )}

      {err && <div className="text-red text-[12px] mb-2">{err}</div>}
      {confirming ? (
        <div className="bg-surface border border-rule rounded-md p-2.5">
          <div className="mb-2">
            ¿Seguro? Esta compra deja de ser <b>{itemName}</b> y pasa a <b>{targetLabel}</b>. Se avisa a quien la pidió, a Bryan y a Daniel{mode === "new" ? `, y ${b2b.the} recibe el pendiente de publicarlo en Dropi` : ""}.
          </div>
          <div className="flex gap-2">
            <button type="button" disabled={busy} className="rounded border border-blue bg-blue px-3 py-1.5 text-[12px] font-bold text-white cursor-pointer disabled:opacity-60" onClick={move}>
              {busy ? "Pasando…" : "Sí, pasar"}
            </button>
            <button type="button" className="text-steel text-[12px] cursor-pointer" onClick={() => setConfirming(false)}>Cancelar</button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button type="button" disabled={!canSubmit} className="rounded border border-blue bg-blue px-3 py-1.5 text-[12px] font-bold text-white cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed" onClick={() => setConfirming(true)}>
            Pasar
          </button>
          <button type="button" className="text-steel text-[12px] cursor-pointer" onClick={close}>Cerrar</button>
        </div>
      )}
    </div>
  );
}
