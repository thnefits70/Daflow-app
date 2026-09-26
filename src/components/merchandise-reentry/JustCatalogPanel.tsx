"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, Clock, Search, Pencil, Check, X } from "lucide-react";
import { CatalogCode } from "@/components/shared/CatalogCode";
import { LegacyUnlinkedItems } from "./LegacyUnlinkedItems";
import { CatalogItemMergeTool } from "./CatalogItemMergeTool";
import { ExpandableName } from "@/components/ui/ExpandableName";

type CatalogItemDTO = { id: string; name: string; justCode: string | null; photos: string[]; pendingRegistration: boolean };
function fmt(iso: string) {
  return new Date(iso).toLocaleString("es-EC", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

type MissingReportDTO = { id: string; query: string; note: string | null; reportedAt: string; reportedBy: { name: string } };

// Confirmado 2026-09-01: pedido explícito del usuario — sugerencia de nicho
// automática al crear un producto (ver purchase-catalog/route.ts), pero el catálogo que ya existía antes de eso
// se quedó sin nicho. Este botón corre esa sugerencia UNA vez sobre lo que
// falta — gasta dinero real, así que muestra el costo estimado y pide
// confirmar antes de disparar.
function NichoBackfillButton() {
  const [info, setInfo] = useState<{ missingCount: number; estimatedCostUsd: number } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/purchase-catalog/backfill-nicho")
      .then((r) => (r.ok ? r.json() : null))
      .then(setInfo)
      .catch(() => null);
  }, []);

  async function run() {
    setBusy(true);
    const res = await fetch("/api/purchase-catalog/backfill-nicho", { method: "POST" });
    const data = await res.json().catch(() => null);
    setBusy(false);
    setConfirming(false);
    if (res.ok) setDone(data?.queuedCount ?? 0);
  }

  if (done !== null) {
    return (
      <div className="flex items-center gap-2 text-teal text-[12.5px] bg-teal/10 border border-teal/30 rounded-md px-3 py-2 mb-4">
        <CheckCircle2 size={14} /> {done} producto{done === 1 ? "" : "s"} en cola — el nicho se irá completando solo en los próximos minutos.
      </div>
    );
  }

  if (!info || info.missingCount === 0) return null;

  return (
    <div className="bg-gold/10 border border-gold/35 rounded-md p-3.5 mb-5 text-[12.5px]" style={{ color: "var(--color-gold)" }}>
      <div className="font-bold mb-1">{info.missingCount} productos del catálogo todavía no tienen nicho asignado</div>
      <div className="mb-2.5">Sugerirlos con IA costaría aproximadamente ${info.estimatedCostUsd.toFixed(2)} en total (una sola vez).</div>
      {confirming ? (
        <div className="flex items-center gap-2">
          <button type="button" disabled={busy} className="rounded border border-teal bg-teal px-3 py-1.5 text-[12px] font-bold text-navy cursor-pointer disabled:opacity-60" onClick={run}>
            {busy ? "Enviando…" : "Sí, sugerir todos"}
          </button>
          <button type="button" className="text-[11px] text-steel cursor-pointer" onClick={() => setConfirming(false)}>
            Cancelar
          </button>
        </div>
      ) : (
        <button type="button" className="rounded border border-rule px-3 py-1.5 text-[12px] font-semibold cursor-pointer" onClick={() => setConfirming(true)}>
          Sugerir nichos faltantes
        </button>
      )}
    </div>
  );
}

// Confirmado 2026-08-29: cola de "avisos de producto faltante" que dispara
// ProductMatchPicker cuando alguien no encuentra un producto (reemplaza
// "escribir el nombre a mano"). Solo la ve quien administra el catálogo.
function MissingReportsQueue() {
  const [reports, setReports] = useState<MissingReportDTO[] | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  function load() {
    fetch("/api/catalog-missing-reports")
      .then((r) => (r.ok ? r.json() : []))
      .then(setReports)
      .catch(() => setReports([]));
  }
  useEffect(load, []);

  async function resolve(id: string) {
    setResolvingId(id);
    await fetch(`/api/catalog-missing-reports/${id}/resolve`, { method: "POST" }).catch(() => null);
    setResolvingId(null);
    load();
  }

  if (!reports || reports.length === 0) return null;

  return (
    <div className="bg-gold/10 border border-gold/35 rounded-md p-3.5 mb-5">
      <div className="flex items-center gap-1.5 text-[12px] font-bold mb-2.5" style={{ color: "var(--color-gold)" }}>
        <AlertTriangle size={14} /> Productos que no encontraron ({reports.length})
      </div>
      <div className="flex flex-col gap-1.5">
        {reports.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-2 bg-surface border border-rule rounded-md px-3 py-2">
            <div className="min-w-0 text-[12px]">
              <div className="font-semibold truncate">&quot;{r.query}&quot;</div>
              <div className="text-[10.5px] text-steel">{r.reportedBy.name} · {fmt(r.reportedAt)}{r.note ? ` · ${r.note}` : ""}</div>
            </div>
            <button
              type="button"
              disabled={resolvingId === r.id}
              className="shrink-0 text-[11px] font-bold text-teal cursor-pointer disabled:opacity-50"
              onClick={() => resolve(r.id)}
            >
              Ya lo agregué
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// Corregir a mano el nombre de un producto ya existente en el catálogo —
// pedido explícito del usuario 2026-09-02: no había forma de arreglar un
// nombre mal escrito salvo re-subiendo el Excel completo. Exclusivo
// de quien administra el catálogo (canManage = Daniel/admin).
function RenameCatalogItem({ item, onRenamed }: { item: CatalogItemDTO; onRenamed: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(item.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    const trimmed = value.trim();
    if (!trimmed || trimmed === item.name) {
      setEditing(false);
      setValue(item.name);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/merchandise-reentry/catalog-items/${item.id}/rename`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "No se pudo guardar.");
      onRenamed(trimmed);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <>
        <ExpandableName text={item.name} className="text-[12.5px] flex-1" />
        <button type="button" title="Corregir nombre" className="shrink-0 text-steel hover:text-teal cursor-pointer" onClick={() => setEditing(true)}>
          <Pencil size={12} />
        </button>
      </>
    );
  }

  return (
    <div className="flex-1 min-w-0 flex items-center gap-1.5">
      <input
        autoFocus
        disabled={busy}
        className="flex-1 min-w-0 rounded border border-teal bg-cloud px-2 py-1 text-[12.5px] disabled:opacity-60"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") {
            setEditing(false);
            setValue(item.name);
          }
        }}
      />
      <button type="button" disabled={busy} title="Guardar" className="shrink-0 text-teal cursor-pointer disabled:opacity-50" onClick={save}>
        <Check size={14} />
      </button>
      <button
        type="button"
        disabled={busy}
        title="Cancelar"
        className="shrink-0 text-steel hover:text-red cursor-pointer disabled:opacity-50"
        onClick={() => {
          setEditing(false);
          setValue(item.name);
          setError("");
        }}
      >
        <X size={14} />
      </button>
      {error && <span className="text-red text-[11px] shrink-0">{error}</span>}
    </div>
  );
}

// Corregir a mano el código de un producto ya existente — pedido explícito
// del usuario 2026-09-21: había productos sin código o con uno equivocado,
// y hasta ahora la única forma de arreglarlo era re-crear el producto. Mismo permiso y mismo patrón que
// RenameCatalogItem.
function EditJustCode({ item, onChanged }: { item: CatalogItemDTO; onChanged: (justCode: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(item.justCode ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    const trimmed = value.trim();
    if (!trimmed || trimmed === item.justCode) {
      setEditing(false);
      setValue(item.justCode ?? "");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/merchandise-reentry/catalog-items/${item.id}/just-code`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ justCode: trimmed }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "No se pudo guardar.");
      onChanged(trimmed);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-1 shrink-0">
        {item.justCode ? (
          <CatalogCode code={item.justCode} />
        ) : (
          <span className="text-[10.5px] text-steel italic">sin código</span>
        )}
        <button type="button" title="Corregir código" className="text-steel hover:text-teal cursor-pointer" onClick={() => setEditing(true)}>
          <Pencil size={11} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <input
        autoFocus
        disabled={busy}
        className="w-24 rounded border border-teal bg-cloud px-1.5 py-0.5 text-[11px] font-mono disabled:opacity-60"
        value={value}
        placeholder="Código"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") {
            setEditing(false);
            setValue(item.justCode ?? "");
            setError("");
          }
        }}
      />
      <button type="button" disabled={busy} title="Guardar" className="text-teal cursor-pointer disabled:opacity-50" onClick={save}>
        <Check size={13} />
      </button>
      <button
        type="button"
        disabled={busy}
        title="Cancelar"
        className="text-steel hover:text-red cursor-pointer disabled:opacity-50"
        onClick={() => {
          setEditing(false);
          setValue(item.justCode ?? "");
          setError("");
        }}
      >
        <X size={13} />
      </button>
      {error && <span className="text-red text-[10.5px]">{error}</span>}
    </div>
  );
}

// Confirmado 2026-09-23, pedido explícito del usuario: ya solo se trabaja
// con INVESTOCK — Daniel ya no descarga ni sube el listado de Just. Este es
// el catálogo maestro de DAFLOW: los productos nuevos se crean directo en
// DAFLOW (Compras, Reingreso, Ventas Externas), y acá se corrigen códigos y
// nombres, se juntan repetidos y se atienden los reportes de "no encontrado".
export function JustCatalogPanel({ canManage }: { canManage: boolean }) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<CatalogItemDTO[]>([]);
  const [query, setQuery] = useState("");
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  function load() {
    fetch("/api/merchandise-reentry/just-catalog")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data) => setItems(data.items ?? []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const q = query.trim().toLowerCase();
  const filtered = q ? items.filter((i) => i.name.toLowerCase().includes(q) || (i.justCode ?? "").toLowerCase().includes(q)) : items;

  if (loading) return <div className="text-[13px] text-steel">Cargando…</div>;

  return (
    <div>
      <div className="bg-surface border border-rule rounded-md p-4 mb-4">
        <div className="text-[12.5px] text-steel">
          Código y nombre de cada producto de DAFLOW — se usa para que Compras y Reingreso sugieran siempre el nombre correcto. Los productos nuevos se crean directo en DAFLOW; acá corriges el código o el nombre de cualquiera.
        </div>
      </div>

      <LegacyUnlinkedItems />
      <CatalogItemMergeTool items={items} onChanged={load} />
      {canManage && <NichoBackfillButton />}
      {canManage && <MissingReportsQueue />}

      <div className="relative mb-3">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-steel" />
        <input
          className="w-full max-w-sm rounded border border-rule pl-8.5 pr-3 py-2 text-[13px]"
          placeholder="Buscar por nombre o código"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5 max-h-[28rem] overflow-y-auto">
        {filtered.length === 0 && <div className="text-[12.5px] text-steel">Nada que mostrar.</div>}
        {filtered.map((item) => (
          <div key={item.id} className="flex items-center gap-2.5 bg-surface border border-rule rounded-md px-3 py-2">
            {item.photos[0] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.photos[0]}
                alt={item.name}
                className="w-8 h-8 object-cover rounded border border-rule shrink-0 cursor-zoom-in"
                onClick={() => setLightboxUrl(item.photos[0])}
              />
            ) : (
              <div className="w-8 h-8 rounded border border-dashed border-rule shrink-0 flex items-center justify-center text-steel">
                <Clock size={13} />
              </div>
            )}
            {canManage ? (
              <EditJustCode
                item={item}
                onChanged={(justCode) => setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, justCode } : i)))}
              />
            ) : (
              <CatalogCode code={item.justCode} />
            )}
            {canManage ? (
              <RenameCatalogItem
                item={item}
                onRenamed={(name) => setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, name } : i)))}
              />
            ) : (
              <ExpandableName text={item.name} className="text-[12.5px] flex-1" />
            )}
            {item.pendingRegistration && (
              <span className="shrink-0 font-mono text-[9px] font-bold uppercase rounded-full px-1.5 py-0.5 bg-gold/15 border border-gold/40" style={{ color: "var(--color-gold)" }}>
                Pendiente de matricular
              </span>
            )}
          </div>
        ))}
      </div>

      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center cursor-zoom-out p-6"
          onClick={() => setLightboxUrl(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightboxUrl} alt="" className="max-w-[90vw] max-h-[90vh] object-contain rounded-md shadow-2xl" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}
