"use client";

import { useState } from "react";
import { X } from "lucide-react";

// Variantes como en Dropi (pedido de DANIEL 2026-10-17, aprobado por el
// usuario): por cada ID madre, cada variante con su ID de variación de Dropi,
// el nombre exacto de Dropi y lo que se contó en bodega. Solo DANIEL y el
// admin; lo de DANIEL queda pendiente hasta que el admin lo apruebe.
type Existing = { id: string; name: string; stock: number; dropiVariantId: string | null };
type Line = { dropiId: string; name: string; qty: string; previousId: string };

export function DropiVariantsTrigger({
  catalogItemId,
  name,
  justCode,
  currentBalance,
  isAdmin,
  organized,
  variants,
  onChanged,
}: {
  catalogItemId: string;
  name: string;
  justCode: string | null;
  currentBalance: number;
  isAdmin: boolean;
  organized: boolean;
  variants: Existing[] | null;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        title="Poner las variantes con su ID de variación y nombre como en Dropi, con lo que contaste"
        className="text-[9.5px] font-bold uppercase text-steel hover:text-teal cursor-pointer shrink-0"
        onClick={() => setOpen(true)}
      >
        {organized ? "Variantes Dropi" : "Variantes Dropi +"}
      </button>
      {open && (
        <DropiVariantsModal
          catalogItemId={catalogItemId}
          name={name}
          justCode={justCode}
          currentBalance={currentBalance}
          isAdmin={isAdmin}
          variants={variants ?? []}
          onClose={() => setOpen(false)}
          onDone={() => {
            setOpen(false);
            onChanged();
          }}
        />
      )}
    </>
  );
}

function DropiVariantsModal({
  catalogItemId,
  name,
  justCode,
  currentBalance,
  isAdmin,
  variants,
  onClose,
  onDone,
}: {
  catalogItemId: string;
  name: string;
  justCode: string | null;
  currentBalance: number;
  isAdmin: boolean;
  variants: Existing[];
  onClose: () => void;
  onDone: () => void;
}) {
  // Se empieza con las variantes que ya hay en DAFLOW; la cantidad va vacía a
  // propósito: es lo que se cuenta, no lo que dice el sistema ni Dropi.
  const [lines, setLines] = useState<Line[]>(() =>
    variants.length > 0
      ? variants.map((v) => ({ dropiId: v.dropiVariantId ?? "", name: v.name, qty: "", previousId: v.id }))
      : [{ dropiId: "", name: "", qty: "", previousId: "" }],
  );
  const [reason, setReason] = useState("Variantes organizadas como en Dropi");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const total = lines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
  const set = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const usedPrev = new Set(lines.map((l) => l.previousId).filter(Boolean));

  async function submit() {
    if (lines.length === 0) return setError("Agrega al menos una variante.");
    if (lines.some((l) => !l.dropiId.replace(/\D/g, ""))) return setError("Pon el ID de variación de Dropi de cada variante (ej. 76777).");
    if (lines.some((l) => !l.name.trim())) return setError("Escribe el nombre de cada variante tal como está en Dropi.");
    if (lines.some((l) => l.qty.trim() === "" || !Number.isInteger(Number(l.qty)) || Number(l.qty) < 0)) return setError("Escribe cuántas contaste de cada variante (0 si no hay).");
    if (!reason.trim()) return setError("Escribe el motivo.");
    const msg = isAdmin
      ? `¿Aplicar de una vez? Las variantes quedan como en Dropi y el stock pasa de ${currentBalance} a ${total}.`
      : `¿Enviar a Andrés para que lo apruebe? Stock actual: ${currentBalance}, contaste: ${total}. No cambia nada hasta que lo apruebe.`;
    if (!window.confirm(msg)) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/inventory-control/catalog-items/${catalogItemId}/physical-count-adjustment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestedQuantity: total,
          reason: reason.trim(),
          dropiVariants: lines.map((l) => ({ dropiId: l.dropiId.replace(/\D/g, ""), name: l.name.trim(), qty: Number(l.qty), previousId: l.previousId || null })),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "No se pudo enviar.");
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo enviar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-3 overflow-y-auto" onClick={onClose}>
      <div className="w-full max-w-[680px] mt-10 rounded-lg border border-rule bg-surface p-4 text-[13px] text-ink shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-2 mb-1">
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-bold uppercase text-teal">Variantes como en Dropi</div>
            <div className="font-semibold break-words">{name}{justCode ? ` · ID ${justCode}` : ""}</div>
          </div>
          <button type="button" title="Cerrar" className="text-steel hover:text-red cursor-pointer" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <p className="text-[12px] text-steel mb-2">
          Copia de Dropi el <b className="text-ink">ID de variación</b> (ej. 76777) y el <b className="text-ink">nombre exacto</b> de cada variante. En cantidad pon lo que{" "}
          <b className="text-ink">contaste en bodega</b>, no el stock que muestra Dropi. En «Antes en DAFLOW» elige cómo se llamaba esa variante aquí, así no se pierden sus guías y conteos.
        </p>

        <div className="hidden sm:grid grid-cols-[90px_1fr_1fr_80px_20px] gap-2 text-[11px] font-semibold text-steel mb-1">
          <span>ID Dropi</span>
          <span>Nombre en Dropi</span>
          <span>Antes en DAFLOW</span>
          <span>Contaste</span>
          <span />
        </div>
        <div className="flex flex-col gap-2 sm:gap-1">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-2 sm:grid-cols-[90px_1fr_1fr_80px_20px] gap-1.5 sm:gap-2 items-center border-b border-rule pb-2 sm:border-0 sm:pb-0">
              <input disabled={busy} inputMode="numeric" placeholder="ID Dropi" className="min-w-0 rounded border border-rule bg-cloud px-2 py-1 font-mono" value={l.dropiId} onChange={(e) => set(i, { dropiId: e.target.value })} />
              <input disabled={busy} maxLength={60} placeholder="Nombre en Dropi" className="min-w-0 rounded border border-rule bg-cloud px-2 py-1" value={l.name} onChange={(e) => set(i, { name: e.target.value })} />
              <select disabled={busy} className="min-w-0 rounded border border-rule bg-cloud px-1 py-1 text-[12px]" value={l.previousId} onChange={(e) => set(i, { previousId: e.target.value })}>
                <option value="">— Nueva —</option>
                {variants.map((v) => (
                  <option key={v.id} value={v.id} disabled={usedPrev.has(v.id) && v.id !== l.previousId}>
                    {v.name}
                  </option>
                ))}
              </select>
              <input disabled={busy} type="number" min="0" step="1" placeholder="0" className="min-w-0 rounded border border-teal bg-cloud px-2 py-1 font-mono" value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} />
              <button type="button" disabled={busy} title="Quitar esta línea" className="text-steel hover:text-red cursor-pointer justify-self-start" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
        <button type="button" disabled={busy} className="mt-2 text-[12px] font-bold text-teal cursor-pointer" onClick={() => setLines((ls) => [...ls, { dropiId: "", name: "", qty: "", previousId: "" }])}>
          + Agregar variante
        </button>

        <div className="mt-2 text-[12.5px]">
          Total contado: <b className="font-mono">{total}</b> · Stock en DAFLOW hoy: <b className="font-mono">{currentBalance}</b>
          {total !== currentBalance && <span className="text-amber"> · diferencia {total - currentBalance > 0 ? "+" : ""}{total - currentBalance}</span>}
        </div>
        {variants.length > 0 && <div className="text-[11.5px] text-steel">Las variantes de DAFLOW que no elijas en ninguna línea se quitan si quedan en 0 («Sin talla» se deja).</div>}
        <input disabled={busy} placeholder="Motivo" className="mt-2 w-full rounded border border-rule bg-cloud px-2 py-1" value={reason} onChange={(e) => setReason(e.target.value)} />
        {error && <div className="mt-2 text-red text-[12px]">{error}</div>}
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" disabled={busy} className="rounded border border-rule px-3 py-1.5 text-steel cursor-pointer" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" disabled={busy} className="rounded border border-teal bg-teal px-3 py-1.5 font-bold text-navy cursor-pointer disabled:opacity-50" onClick={submit}>
            {busy ? "Enviando…" : isAdmin ? "Aplicar" : "Enviar para aprobar"}
          </button>
        </div>
      </div>
    </div>
  );
}
