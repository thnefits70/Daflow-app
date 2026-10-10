"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { ComboComponentBuilder, type ComboDraftComponent } from "@/components/merchandise-reentry/ComboComponentBuilder";
import { ComboAliasConfirm, type AliasMother } from "@/components/shared/ComboAliasConfirm";
import { COMBO_BRAND_LABELS } from "@/components/shared/ComboBrandInfo";
import { CatalogCode } from "@/components/shared/CatalogCode";
import { ExpandableName } from "@/components/ui/ExpandableName";

type Platform = "DROPI" | "ROCKET";

// Pedido del usuario 2026-10-10: cada combo que un asesor crea en Dropi o en
// Rocket se registra aquí al crearlo, con su marca y sus productos — todo
// obligatorio y con doble confirmación. Así, cuando se venda, el corte ya lo
// reconoce y la marca nunca queda faltando para los demás flujos.
export function AdvisorComboRegister() {
  const [platform, setPlatform] = useState<Platform>("DROPI");
  const [id, setId] = useState("");
  const [label, setLabel] = useState("");
  const [brand, setBrand] = useState("");
  const [components, setComponents] = useState<ComboDraftComponent[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const [aliasMother, setAliasMother] = useState<AliasMother | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");

  const units = components.reduce((s, c) => s + c.quantity, 0);
  const ready = /^\d+$/.test(id.trim()) && label.trim() && brand && units >= 2 && components.every((c) => c.quantity >= 1);

  function reset() {
    setId("");
    setLabel("");
    setBrand("");
    setComponents([]);
    setReviewing(false);
    setAliasMother(null);
    setErr("");
  }

  async function save(confirmAlias = false) {
    setSaving(true);
    setErr("");
    const res = await fetch("/api/dropi-combos/advisor-register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform,
        id: id.trim(),
        label: label.trim(),
        bodega: brand,
        confirmAlias,
        components: components.map((c) => ({ catalogItemId: c.catalogItem.id, quantity: c.quantity })),
      }),
    });
    const json = await res.json().catch(() => null);
    setSaving(false);
    if (res.status === 409 && json?.needsAliasConfirm) {
      setAliasMother(json.mother as AliasMother);
      return;
    }
    if (!res.ok) {
      setErr(json?.error ?? "No se pudo registrar el combo.");
      setAliasMother(null);
      setReviewing(false);
      return;
    }
    const where = platform === "ROCKET" ? "Rocket" : "Dropi";
    setDone(
      json.aliasOf
        ? `Listo: el ID ${id.trim()} de ${where} quedó unido al combo ${json.aliasOf} y lleva su marca.`
        : `Listo: el combo ${id.trim()} de ${where} quedó registrado como ${COMBO_BRAND_LABELS[json.bodega] ?? json.bodega}.`
    );
    reset();
  }

  const shownId = `${platform === "ROCKET" ? "Rocket " : ""}${id.trim()}`;

  return (
    <div className="max-w-2xl">
      <div className="text-[13px] font-bold mb-1">Registrar un combo que creaste</div>
      <div className="text-[12px] text-steel mb-3">
        Cada vez que crees un combo en Dropi o en Rocket, regístralo aquí con su marca y los productos que trae. Así, cuando se venda, DAFLOW ya sabe qué
        sale de bodega y de qué marca es.
      </div>
      {done && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-teal/50 bg-teal/10 p-2.5 text-[12px]">
          <CheckCircle2 size={14} className="text-teal mt-0.5 shrink-0" /> {done}
        </div>
      )}

      {aliasMother ? (
        <ComboAliasConfirm newCode={shownId} mother={aliasMother} busy={saving} onConfirm={() => save(true)} onReject={() => { setAliasMother(null); setReviewing(false); }} />
      ) : reviewing ? (
        <div className="rounded-md border border-gold/60 bg-surface p-3">
          <div className="text-[12.5px] font-bold mb-2">Revisa antes de guardar</div>
          <div className="text-[12px] mb-1">
            {platform === "ROCKET" ? "ID de Rocket" : "ID de Dropi"}: <span className="font-mono font-bold">{id.trim()}</span> — {label.trim()}
          </div>
          <div className="text-[12px] mb-2">
            Marca: <span className="font-bold">{COMBO_BRAND_LABELS[brand]}</span>
          </div>
          <div className="flex flex-col gap-1.5 mb-2.5">
            {components.map((c) => (
              <div key={c.catalogItem.id} className="flex items-center gap-2 bg-cloud border border-rule rounded-md p-1.5">
                {c.catalogItem.photos[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img loading="lazy" decoding="async" src={c.catalogItem.photos[0]} alt="" className="w-8 h-8 object-cover rounded border border-rule shrink-0" />
                ) : (
                  <div className="w-8 h-8 rounded border border-dashed border-rule shrink-0 flex items-center justify-center text-steel">
                    <Clock size={12} />
                  </div>
                )}
                <CatalogCode code={c.catalogItem.justCode} />
                <ExpandableName text={c.catalogItem.name} className="flex-1 text-[11.5px]" />
                <span className="font-mono text-[12px] font-bold text-teal shrink-0">{c.quantity}×</span>
              </div>
            ))}
          </div>
          <div className="text-[11px] text-steel mb-2.5 flex items-start gap-1.5">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" /> Confirma que la marca, los productos y las cantidades son correctos. Una vez guardado no se
            puede cambiar; si hay un error, solo el administrador lo corrige.
          </div>
          {err && <div className="text-red text-[11.5px] mb-2">{err}</div>}
          <div className="flex gap-2">
            <button type="button" disabled={saving} className="flex-1 rounded border border-teal bg-teal px-3 py-1.5 text-[12px] font-bold text-navy cursor-pointer disabled:opacity-60" onClick={() => save()}>
              {saving ? "Guardando…" : "Sí, registrar combo"}
            </button>
            <button type="button" disabled={saving} className="flex-1 rounded border border-rule px-3 py-1.5 text-[12px] font-semibold cursor-pointer" onClick={() => setReviewing(false)}>
              Corregir
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-cloud rounded-md p-3">
          <div className="text-[10px] text-steel mb-1">¿Dónde lo creaste?</div>
          <div className="flex gap-2 mb-2.5">
            {(["DROPI", "ROCKET"] as Platform[]).map((p) => (
              <button
                key={p}
                type="button"
                className={`rounded-full border px-3 py-1 text-[12px] font-semibold cursor-pointer ${platform === p ? "border-teal bg-teal/15 text-ink" : "border-rule text-steel"}`}
                onClick={() => setPlatform(p)}
              >
                {p === "DROPI" ? "Dropi" : "Rocket"}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 mb-2.5">
            <div className="w-36">
              <div className="text-[10px] text-steel mb-0.5">{platform === "ROCKET" ? "ID de Rocket" : "ID de Dropi"} (obligatorio)</div>
              <input type="text" inputMode="numeric" className="w-full rounded border border-rule bg-surface px-2.5 py-1.5 text-[12.5px] font-mono" value={id} onChange={(e) => setId(e.target.value)} />
            </div>
            <div className="flex-1 min-w-[200px]">
              <div className="text-[10px] text-steel mb-0.5">Nombre del combo (obligatorio)</div>
              <input type="text" className="w-full rounded border border-rule bg-surface px-2.5 py-1.5 text-[12.5px]" value={label} onChange={(e) => setLabel(e.target.value)} />
            </div>
          </div>
          <div className="text-[10px] text-steel mb-1">Marca (obligatorio) — la cuenta donde lo publicaste</div>
          <div className="flex flex-wrap gap-2 mb-2.5">
            {Object.entries(COMBO_BRAND_LABELS).map(([k, l]) => (
              <button
                key={k}
                type="button"
                className={`rounded-full border px-3 py-1 text-[12px] font-semibold cursor-pointer ${brand === k ? "border-teal bg-teal/15 text-ink" : "border-rule text-steel"}`}
                onClick={() => setBrand(k)}
              >
                {l}
              </button>
            ))}
          </div>
          <div className="text-[10px] text-steel mb-1.5">Productos reales que trae y cuántas unidades de cada uno (obligatorio):</div>
          <ComboComponentBuilder components={components} onChange={setComponents} searchUrl="/api/dropi-combos/advisor-catalog-search" />
          {err && <div className="text-red text-[11.5px] mt-2">{err}</div>}
          <button
            type="button"
            disabled={!ready}
            className="mt-3 w-full rounded border border-teal bg-teal px-3 py-1.5 text-[12px] font-bold text-navy cursor-pointer disabled:opacity-50"
            onClick={() => {
              setDone("");
              setReviewing(true);
            }}
          >
            Continuar
          </button>
          {!ready && <div className="text-[10.5px] text-steel mt-1">Completa el ID, el nombre, la marca y al menos 2 productos (o 2 unidades) para continuar.</div>}
        </div>
      )}
    </div>
  );
}
