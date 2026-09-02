"use client";

import { useState } from "react";
import { Camera, Check } from "lucide-react";
import { LiveCameraCapture } from "@/components/shared/LiveCameraCapture";
import { ProductMatchPicker, type MatchCatalogItem, type ProductMatchResult } from "@/components/merchandise-reentry/ProductMatchPicker";
import { CatalogCode } from "@/components/shared/CatalogCode";

const DAMAGE_REASONS = ["Producto roto", "Empaque abierto", "Humedad/manchado", "Golpeado", "Otro"];

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "Ocurrió un error.");
  return data;
}

// Reporte de un producto encontrado dañado en bodega — NO una devolución
// (eso vive en Reingreso). Un solo paso, sin borrador: foto + producto +
// cantidad + motivo, y queda directo en la cola de Daniel.
// Confirmado 2026-09-02: por ahora solo Daniel reporta acá (su equipo
// todavía no usa esta pestaña) y lo hace desde la computadora, sin cámara
// — allowUpload queda atado a canAct (exclusivo de Daniel) para que cuando
// el equipo empiece a reportar desde el celular en bodega, ellos sigan
// restringidos a cámara en vivo por defecto.
export function DeteriorCapture({ onReported, allowUpload = false }: { onReported?: () => void; allowUpload?: boolean }) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [taking, setTaking] = useState(false);
  const [selected, setSelected] = useState<MatchCatalogItem | null>(null);
  const [quantity, setQuantity] = useState("");
  const [damageReason, setDamageReason] = useState("");
  const [damageReasonOther, setDamageReasonOther] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  function reset() {
    setPhotoUrl(null);
    setSelected(null);
    setQuantity("");
    setDamageReason("");
    setDamageReasonOther("");
    setConfirming(false);
    setSent(false);
  }

  const qty = Number(quantity) || 0;
  const hasReason = !!damageReason && (damageReason !== "Otro" || damageReasonOther.trim().length > 0);
  const canSave = !!photoUrl && !!selected && qty > 0 && hasReason && !saving;
  const finalName = selected?.name ?? "";

  async function save() {
    if (!photoUrl || !selected) return;
    setSaving(true);
    setError("");
    try {
      await postJson("/api/merchandise-outflow/deterioro", {
        photoUrl,
        catalogItemId: selected.id,
        quantity: qty,
        damageReasonName: damageReason,
        damageReasonOther: damageReason === "Otro" ? damageReasonOther.trim() : undefined,
      });
      setSent(true);
      onReported?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo enviar el reporte.");
    } finally {
      setSaving(false);
    }
  }

  if (sent) {
    return (
      <div className="bg-surface border border-rule rounded-md p-6 max-w-sm text-center">
        <div className="w-11 h-11 rounded-full bg-green/15 border border-green/40 flex items-center justify-center mx-auto mb-3">
          <Check size={20} className="text-green" />
        </div>
        <div className="font-display font-bold text-[15px] mb-1.5">Reportado</div>
        <p className="text-[12.5px] text-steel mb-4">Daniel ya fue avisado.</p>
        <button type="button" className="text-[12.5px] font-bold text-teal cursor-pointer" onClick={reset}>
          Reportar otro
        </button>
      </div>
    );
  }

  if (confirming) {
    return (
      <div className="bg-surface border border-rule rounded-md p-4 max-w-sm">
        <div className="font-display font-bold text-[14px] mb-2.5">Revisa antes de reportar</div>
        {photoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt="Foto del producto" className="w-16 h-16 object-cover rounded-md border border-rule mb-3" />
        )}
        <div className="flex flex-col gap-2 text-[12.5px] mb-3">
          <div className="flex items-start justify-between gap-3"><span className="text-steel shrink-0">Producto</span><span className="font-semibold text-right flex items-center gap-1.5">{selected && <CatalogCode code={selected.justCode} />} {finalName}</span></div>
          <div className="flex items-start justify-between gap-3"><span className="text-steel shrink-0">Cantidad</span><span className="font-semibold">{qty}</span></div>
          <div className="flex items-start justify-between gap-3"><span className="text-steel shrink-0">Motivo</span><span className="font-semibold text-right">{damageReason === "Otro" ? damageReasonOther : damageReason}</span></div>
        </div>
        {error && <div className="text-red text-[11.5px] mb-2">{error}</div>}
        <div className="flex gap-2">
          <button type="button" className="flex-1 rounded border border-rule px-3 py-2 text-[12px] font-semibold cursor-pointer" onClick={() => setConfirming(false)}>Revisar de nuevo</button>
          <button type="button" disabled={saving} className="flex-1 rounded border border-teal bg-teal px-3 py-2 text-[12px] font-bold text-navy cursor-pointer disabled:opacity-60" onClick={save}>
            {saving ? "Enviando…" : "Sí, reportar"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface border border-rule rounded-md p-3.5 flex flex-col gap-3.5 max-w-sm">
      <div>
        <label className="block mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-steel">1 · Foto del producto</label>
        {photoUrl ? (
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photoUrl} alt="Foto del producto" className="w-20 h-20 object-cover rounded-md border border-rule" />
            <button type="button" className="text-[11.5px] text-blue font-semibold cursor-pointer" onClick={() => { setPhotoUrl(null); setTaking(true); }}>Volver a tomar</button>
          </div>
        ) : taking ? (
          <LiveCameraCapture allowUpload={allowUpload} folder="merchandise-outflow-photos" onCaptured={(url) => { setPhotoUrl(url); setTaking(false); }} onCancel={() => setTaking(false)} />
        ) : (
          <button type="button" className="flex items-center gap-1.5 text-[12.5px] font-bold border-[1.5px] border-rule rounded-md px-3.5 py-2 cursor-pointer" onClick={() => setTaking(true)}>
            <Camera size={14} /> {allowUpload ? "Tomar o subir foto" : "Tomar foto en vivo"}
          </button>
        )}
      </div>

      {photoUrl && (
        <div>
          <label className="block mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-steel">2 · Producto</label>
          {selected ? (
            <div className="flex items-center gap-2.5 bg-green/10 border border-green/35 rounded-md p-2.5">
              <div className="flex-1 min-w-0 text-[12.5px] font-semibold flex items-center gap-1.5">
                <CatalogCode code={selected.justCode} />
                <span className="truncate">{selected.name}</span>
              </div>
              <button type="button" className="shrink-0 text-[11px] font-semibold text-blue cursor-pointer" onClick={() => setSelected(null)}>Cambiar</button>
            </div>
          ) : (
            <ProductMatchPicker referencePhotoUrl={photoUrl} onConfirm={(r: ProductMatchResult) => setSelected(r)} />
          )}
        </div>
      )}

      {photoUrl && (
        <div>
          <label className="block mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-steel">3 · Cantidad dañada</label>
          <input type="number" min={1} className="w-24 rounded border border-rule bg-cloud px-2.5 py-1.5 text-[13px] font-bold text-red" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </div>
      )}

      {photoUrl && (
        <div>
          <label className="block mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-steel">4 · Motivo del daño</label>
          <div className="flex gap-1.5 flex-wrap">
            {DAMAGE_REASONS.map((r) => (
              <button key={r} type="button" onClick={() => setDamageReason(r)} className={`text-[11.5px] font-semibold rounded-full px-2.5 py-1 border cursor-pointer ${damageReason === r ? "border-teal text-teal bg-teal/15" : "border-rule text-steel"}`}>
                {r}
              </button>
            ))}
          </div>
          {damageReason === "Otro" && (
            <input type="text" placeholder="Describe el motivo" className="w-full mt-1.5 rounded border border-rule bg-cloud px-2.5 py-1.5 text-[12px]" value={damageReasonOther} onChange={(e) => setDamageReasonOther(e.target.value)} />
          )}
        </div>
      )}

      {error && <div className="text-red text-[11.5px]">{error}</div>}

      <button type="button" disabled={!canSave} className="rounded border border-teal bg-teal px-3 py-2 text-[12.5px] font-bold text-navy cursor-pointer disabled:opacity-40" onClick={() => setConfirming(true)}>
        Reportar deterioro
      </button>
    </div>
  );
}
