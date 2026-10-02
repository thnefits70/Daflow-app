"use client";

import { useEffect, useState } from "react";
import { Camera, Loader2, PackageCheck } from "lucide-react";
import { anyReasonLabel } from "@/lib/localWarrantyConstants";
import { formatDateTime } from "@/lib/formatDateTime";
import { uploadFile } from "@/lib/uploadFile";

type Item = { id: string; quantity: number; warrantyReason: string | null; declaredProductName: string; pickupReceivedAt: string | null; catalogItem: { name: string; photos: string[]; justCode: string | null } | null };
type Row = { id: string; code: string; clientName: string | null; pickupPersonName: string; deliveredAt: string; advisor: { name: string }; items: Item[] };
type ItemState = { condition: "" | "GOOD" | "DAMAGED"; damageReason: string; photos: string[] };

// Mismos motivos que Reingreso de Mercadería + "No funciona" (garantías).
const DAMAGE_REASONS = ["No funciona", "Producto roto", "Empaque abierto", "Humedad/manchado", "Golpeado"];

const isDefective = (i: Item) => i.warrantyReason === "MAL_FUNCIONAMIENTO" || i.warrantyReason === "PRODUCTO_ROTO";

// Garantías locales (pedido del usuario 2026-10-02): lo que el motorizado
// recogió donde el cliente llega a bodega. Lo dañado que se cambió entra al
// Reingreso de Mercadería (bueno → vuelve al stock; dañado → Daniel decide
// reparar, reclamar al proveedor o dar de baja). Lo que se mandó por error o
// de más vuelve a la percha sin mover el stock (nunca se descontó).
export function WarrantyPickupInbox() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [state, setState] = useState<Record<string, ItemState>>({});
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");

  function load() {
    fetch("/api/external-sales/pending-pickups")
      .then((r) => (r.ok ? r.json() : []))
      .then(setRows)
      .catch(() => setRows([]));
  }
  useEffect(load, []);

  const st = (id: string): ItemState => state[id] ?? { condition: "", damageReason: "", photos: [] };
  const patch = (id: string, p: Partial<ItemState>) => setState((prev) => ({ ...prev, [id]: { ...st(id), ...p } }));

  async function addPhoto(itemId: string, files: FileList | null) {
    if (!files?.[0]) return;
    setBusy(itemId);
    const r = await uploadFile(files[0], "merchandise-outflow-photos");
    setBusy(null);
    if (r.ok) patch(itemId, { photos: [...st(itemId).photos, r.url] });
    else setErr(r.error);
  }

  function ready(r: Row): boolean {
    return r.items
      .filter((i) => !i.pickupReceivedAt && isDefective(i))
      .every((i) => {
        const s = st(i.id);
        return !!s.condition && s.photos.length > 0 && (s.condition === "GOOD" || !!s.damageReason);
      });
  }

  async function receive(r: Row) {
    setBusy(r.id);
    setErr("");
    setDone("");
    const items = r.items
      .filter((i) => !i.pickupReceivedAt)
      .map((i) => {
        const s = st(i.id);
        return isDefective(i) ? { itemId: i.id, condition: s.condition || undefined, damageReason: s.damageReason || undefined, photoUrls: s.photos } : { itemId: i.id, photoUrls: [] };
      });
    const res = await fetch(`/api/external-sales/${r.id}/pickup-received`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }) });
    const json = await res.json().catch(() => null);
    setBusy(null);
    setConfirming(null);
    if (!res.ok) setErr(json?.error ?? "No se pudo confirmar.");
    else setDone(json?.reentryCode ? `${r.code}: lo dañado quedó en el Reingreso ${json.reentryCode}.` : `${r.code}: confirmado.`);
    load();
  }

  if (rows === null || (rows.length === 0 && !done)) return null;
  return (
    <section className="mb-6">
      <h3 className="font-display text-[15px] font-bold mb-1 flex items-center gap-2">
        <PackageCheck size={15} /> Garantías: lo que trajo el motorizado
      </h3>
      <p className="text-[12px] text-steel mb-2">
        Lo dañado que se cambió entra al Reingreso: si llegó bien vuelve solo al stock; si llegó dañado, Daniel decide si se repara, se reclama al proveedor o se da de baja. Lo que se mandó por error o de más vuelve a la percha sin mover el stock.
      </p>
      {err && <div className="text-red text-[12.5px] mb-2">{err}</div>}
      {done && <div className="text-teal text-[12.5px] mb-2">{done}</div>}
      <div className="flex flex-col gap-2">
        {rows.map((r) => (
          <div key={r.id} className="border border-rule rounded-md p-3 text-[12.5px]">
            <div className="flex flex-wrap gap-x-3">
              <b className="font-mono">{r.code}</b>
              <span>{r.clientName}</span>
              <span className="text-steel">motorizado {r.pickupPersonName} · salió {formatDateTime(r.deliveredAt)} · asesor {r.advisor.name}</span>
            </div>
            <div className="mt-2 flex flex-col gap-2">
              {r.items.map((i) => {
                const s = st(i.id);
                const name = i.catalogItem?.name ?? i.declaredProductName;
                return (
                  <div key={i.id} className="border border-rule rounded p-2">
                    <div>
                      <b>{name}</b> ×{i.quantity} <span className="text-steel">({anyReasonLabel(i.warrantyReason)})</span>
                      {i.pickupReceivedAt && <span className="text-teal"> ✓ recibido</span>}
                    </div>
                    {!i.pickupReceivedAt && !isDefective(i) && <div className="text-steel mt-0.5">Se mandó por error o de más: vuelve a la percha, no mueve el stock.</div>}
                    {!i.pickupReceivedAt && isDefective(i) && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <span>¿Cómo llegó?</span>
                        <label className="flex items-center gap-1 cursor-pointer">
                          <input type="radio" checked={s.condition === "GOOD"} onChange={() => patch(i.id, { condition: "GOOD", damageReason: "" })} /> En buen estado
                        </label>
                        <label className="flex items-center gap-1 cursor-pointer">
                          <input type="radio" checked={s.condition === "DAMAGED"} onChange={() => patch(i.id, { condition: "DAMAGED" })} /> Dañado
                        </label>
                        {s.condition === "DAMAGED" && (
                          <select className="rounded border border-rule bg-surface px-2 py-1" value={s.damageReason} onChange={(e) => patch(i.id, { damageReason: e.target.value })}>
                            <option value="">¿Qué daño tiene?</option>
                            {DAMAGE_REASONS.map((d) => (
                              <option key={d} value={d}>{d}</option>
                            ))}
                          </select>
                        )}
                        <label className="flex items-center gap-1 rounded border border-rule px-2 py-1 cursor-pointer">
                          {busy === i.id ? <Loader2 size={12} className="animate-spin" /> : <Camera size={12} />} Foto {s.photos.length > 0 ? `(${s.photos.length})` : ""}
                          <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => addPhoto(i.id, e.target.files)} />
                        </label>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {confirming === r.id ? (
              <div className="flex flex-wrap items-center gap-2 mt-2 bg-cloud border border-rule rounded px-2 py-1.5">
                ¿Confirmas que llegó todo esto a bodega?
                <button type="button" disabled={busy === r.id} className="rounded border border-gold bg-gold px-2.5 py-1 font-bold text-navy cursor-pointer" onClick={() => receive(r)}>
                  {busy === r.id ? "Guardando…" : "Sí, llegó"}
                </button>
                <button type="button" className="text-steel cursor-pointer" onClick={() => setConfirming(null)}>Cancelar</button>
              </div>
            ) : (
              <button type="button" disabled={!ready(r)} className="mt-2 rounded border border-teal bg-teal px-2.5 py-1 font-bold text-navy cursor-pointer disabled:opacity-50" onClick={() => setConfirming(r.id)}>
                Llegó a bodega
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
