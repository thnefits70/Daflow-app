"use client";

import { useEffect, useState } from "react";
import { GitMerge, Trash2, ChevronDown, ChevronUp, AlertTriangle, CheckCircle2, X, ArrowRight } from "lucide-react";
import { formatDateTime } from "@/lib/formatDateTime";

type CatalogItemLite = { id: string; name: string; justCode: string | null };

type Counts = {
  purchases: number;
  reentryItems: number;
  outflowItems: number;
  externalSaleItems: number;
  personalPurchaseItems: number;
  cancelledGuideItems: number;
  fulfillmentItems: number;
  comboComponents: number;
  expirationLots: number;
  kardexMovements: number;
  otherLinks: number;
};
type Snapshot = { id: string; name: string; justCode: string | null; photo: string | null; balance: number; avgCost: number; counts: Counts };
type Preview = { removed: Snapshot; official: Snapshot | null; result: { balance: number; avgCost: number } | null; blockers: string[] };
type HistoryRow = {
  id: string;
  kind: "MERGE" | "DELETE";
  removedName: string;
  removedJustCode: string | null;
  officialName: string | null;
  officialJustCode: string | null;
  performedByName: string;
  performedAt: string;
};

const COUNT_LABELS: [keyof Counts, string][] = [
  ["purchases", "compras"],
  ["reentryItems", "reingresos"],
  ["outflowItems", "egresos / despachos"],
  ["externalSaleItems", "ventas externas"],
  ["personalPurchaseItems", "compras de colaboradores"],
  ["cancelledGuideItems", "guías anuladas"],
  ["fulfillmentItems", "pedidos de Fulfillment"],
  ["comboComponents", "combos donde aparece"],
  ["expirationLots", "lotes de caducidad"],
  ["kardexMovements", "movimientos de stock"],
  ["otherLinks", "otros vínculos (Rocket, Análisis de Mercado…)"],
];

const money = (n: number) => `$${n.toFixed(2)}`;

function ProductSearch({
  items,
  excludeId,
  placeholder,
  onPick,
}: {
  items: CatalogItemLite[];
  excludeId?: string;
  placeholder: string;
  onPick: (item: CatalogItemLite) => void;
}) {
  const [q, setQ] = useState("");
  const term = q.trim().toLowerCase();
  const results = term
    ? items.filter((i) => i.id !== excludeId && (i.name.toLowerCase().includes(term) || (i.justCode ?? "").toLowerCase().includes(term))).slice(0, 8)
    : [];
  return (
    <div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-surface border border-rule rounded px-2.5 py-1.5 text-[12.5px] outline-none focus:border-teal"
      />
      {results.length > 0 && (
        <div className="mt-1 border border-rule rounded-md bg-surface max-h-56 overflow-y-auto">
          {results.map((i) => (
            <button
              key={i.id}
              type="button"
              className="w-full text-left px-2.5 py-1.5 text-[12px] hover:bg-teal/10 cursor-pointer border-b border-rule last:border-b-0"
              onClick={() => {
                onPick(i);
                setQ("");
              }}
            >
              <span className="font-mono text-steel mr-1.5">{i.justCode ?? "sin código"}</span>
              <span className="font-semibold">{i.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Chosen({ item, label, onClear }: { item: CatalogItemLite; label: string; onClear: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 bg-surface border border-rule rounded px-2.5 py-1.5 text-[12px]">
      <div className="min-w-0">
        <span className="text-steel">{label}: </span>
        <span className="font-mono text-steel mr-1">{item.justCode ?? "sin código"}</span>
        <span className="font-semibold">{item.name}</span>
      </div>
      <button type="button" className="text-steel hover:text-red cursor-pointer shrink-0" onClick={onClear} title="Cambiar">
        <X size={13} />
      </button>
    </div>
  );
}

function SnapshotCard({ s, title, tone }: { s: Snapshot; title: string; tone: "red" | "teal" }) {
  const lines = COUNT_LABELS.filter(([k]) => s.counts[k] > 0);
  return (
    <div className={`flex-1 min-w-[14rem] bg-surface border rounded-md p-2.5 ${tone === "red" ? "border-red/40" : "border-teal/40"}`}>
      <div className={`text-[10.5px] font-bold uppercase tracking-wide mb-1 ${tone === "red" ? "text-red" : "text-teal"}`}>{title}</div>
      <div className="flex gap-2 items-start">
        {s.photo && <img src={s.photo} alt="" className="w-11 h-11 rounded object-cover border border-rule shrink-0" />}
        <div className="min-w-0">
          <div className="text-[12.5px] font-semibold">{s.name}</div>
          <div className="text-[11px] font-mono text-steel">{s.justCode ?? "sin código de Just"}</div>
        </div>
      </div>
      <div className="text-[12px] mt-1.5">
        Stock: <b>{s.balance}</b> u. · Costo promedio: <b>{money(s.avgCost)}</b>
      </div>
      <div className="text-[11px] text-steel mt-1">
        {lines.length === 0 ? "No tiene nada registrado." : lines.map(([k, label]) => `${s.counts[k]} ${label}`).join(" · ")}
      </div>
    </div>
  );
}

// Confirmado 2026-09-22, pedido explícito del usuario: juntar un ID
// duplicado con el oficial, o eliminar un ID mal creado — solo admin.
// Autogateado igual que LegacyUnlinkedItems: si el GET responde 403 (no es
// admin), no se muestra nada.
export function CatalogItemMergeTool({ items, onChanged }: { items: CatalogItemLite[]; onChanged: () => void }) {
  const [allowed, setAllowed] = useState(false);
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [removed, setRemoved] = useState<CatalogItemLite | null>(null);
  const [mode, setMode] = useState<"merge" | "delete" | null>(null);
  const [official, setOfficial] = useState<CatalogItemLite | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");

  function loadHistory() {
    fetch("/api/merchandise-reentry/catalog-merge")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        setAllowed(true);
        setHistory(data.history ?? []);
      })
      .catch(() => null);
  }

  useEffect(loadHistory, []);

  function reset() {
    setRemoved(null);
    setMode(null);
    setOfficial(null);
    setPreview(null);
    setConfirming(false);
    setErr("");
  }

  async function fetchPreview(removedId: string, officialId: string | null) {
    setLoadingPreview(true);
    setPreview(null);
    setConfirming(false);
    setErr("");
    try {
      const res = await fetch("/api/merchandise-reentry/catalog-merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview", removedId, officialId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "No se pudo revisar.");
      setPreview(data.preview);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo revisar.");
    } finally {
      setLoadingPreview(false);
    }
  }

  async function apply() {
    if (!removed || !preview) return;
    setBusy(true);
    setErr("");
    try {
      const body = mode === "merge" ? { action: "merge", removedId: removed.id, officialId: official?.id } : { action: "delete", removedId: removed.id };
      const res = await fetch("/api/merchandise-reentry/catalog-merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "No se pudo completar.");
      setDone(
        mode === "merge"
          ? `"${removed.name}" se juntó con "${official?.name}". Ahora tiene ${data.balance} u. a ${money(data.avgCost)} de costo promedio.`
          : `"${removed.name}" se eliminó.`
      );
      reset();
      loadHistory();
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo completar.");
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  if (!allowed) return null;

  const canApply = !!preview && preview.blockers.length === 0;

  return (
    <div className="bg-surface border border-rule rounded-md p-3.5 mb-5">
      <button type="button" className="w-full flex items-center justify-between gap-2 cursor-pointer" onClick={() => setOpen((o) => !o)}>
        <div className="flex items-center gap-1.5 text-[12.5px] font-bold">
          <GitMerge size={14} className="text-teal" /> Juntar o eliminar IDs <span className="text-[10.5px] font-semibold text-steel">(solo admin)</span>
        </div>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {done && (
        <div className="flex items-center gap-2 text-teal text-[12px] bg-teal/10 border border-teal/30 rounded-md px-3 py-2 mt-2.5">
          <CheckCircle2 size={14} /> {done}
        </div>
      )}

      {open && (
        <div className="mt-2.5 flex flex-col gap-2.5">
          <div className="text-[11.5px] text-steel">
            <b>Juntar:</b> todo lo del ID duplicado (compras, reingresos, ventas, stock) pasa al ID oficial y el duplicado desaparece. El stock se suma.
            <br />
            <b>Eliminar:</b> solo para un ID mal creado que no tiene nada registrado. Si ya tiene un reingreso u otra cosa, usa Juntar para pasarlo al producto correcto.
          </div>

          <div>
            <div className="text-[11px] font-bold mb-1">1. ¿Qué ID quieres quitar?</div>
            {removed ? (
              <Chosen item={removed} label="Quitar" onClear={reset} />
            ) : (
              <ProductSearch
                items={items}
                placeholder="Busca por nombre o código…"
                onPick={(i) => {
                  setDone("");
                  setRemoved(i);
                }}
              />
            )}
          </div>

          {removed && (
            <div>
              <div className="text-[11px] font-bold mb-1">2. ¿Qué hacemos con él?</div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  className={`flex items-center gap-1 rounded border px-2.5 py-1 text-[11.5px] font-bold cursor-pointer ${mode === "merge" ? "border-teal bg-teal text-navy" : "border-teal/50 text-teal hover:bg-teal/10"}`}
                  onClick={() => {
                    setMode("merge");
                    setPreview(null);
                    setOfficial(null);
                    setErr("");
                  }}
                >
                  <GitMerge size={12} /> Juntar con el ID oficial
                </button>
                <button
                  type="button"
                  className={`flex items-center gap-1 rounded border px-2.5 py-1 text-[11.5px] font-bold cursor-pointer ${mode === "delete" ? "border-red bg-red text-white" : "border-red/40 text-red hover:bg-red/10"}`}
                  onClick={() => {
                    setMode("delete");
                    setOfficial(null);
                    fetchPreview(removed.id, null);
                  }}
                >
                  <Trash2 size={12} /> Eliminar (mal creado)
                </button>
              </div>
            </div>
          )}

          {removed && mode === "merge" && (
            <div>
              <div className="text-[11px] font-bold mb-1">3. ¿Cuál es el ID oficial que se queda?</div>
              {official ? (
                <Chosen
                  item={official}
                  label="Se queda"
                  onClear={() => {
                    setOfficial(null);
                    setPreview(null);
                  }}
                />
              ) : (
                <ProductSearch
                  items={items}
                  excludeId={removed.id}
                  placeholder="Busca el ID oficial por nombre o código…"
                  onPick={(i) => {
                    setOfficial(i);
                    fetchPreview(removed.id, i.id);
                  }}
                />
              )}
            </div>
          )}

          {loadingPreview && <div className="text-[12px] text-steel">Revisando todo lo que tiene registrado…</div>}

          {preview && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-stretch gap-2">
                <SnapshotCard s={preview.removed} title={mode === "merge" ? "Se quita" : "Se elimina"} tone="red" />
                {preview.official && (
                  <>
                    <div className="flex items-center text-steel">
                      <ArrowRight size={16} />
                    </div>
                    <SnapshotCard s={preview.official} title="Se queda (oficial)" tone="teal" />
                  </>
                )}
              </div>

              {preview.result && preview.official && (
                <div className="text-[12px] bg-teal/10 border border-teal/30 rounded-md px-3 py-2">
                  Después de juntar, <b>{preview.official.name}</b> quedará con <b>{preview.result.balance}</b> u. ({preview.official.balance} + {preview.removed.balance}) a{" "}
                  <b>{money(preview.result.avgCost)}</b> de costo promedio. Todo lo registrado en el ID que se quita pasa a este.
                </div>
              )}

              {preview.blockers.length > 0 && (
                <div className="bg-red/10 border border-red/30 rounded-md px-3 py-2 text-[12px] text-red flex flex-col gap-1">
                  {preview.blockers.map((b) => (
                    <div key={b} className="flex gap-1.5">
                      <AlertTriangle size={13} className="shrink-0 mt-0.5" /> {b}
                    </div>
                  ))}
                </div>
              )}

              {canApply && !confirming && (
                <button
                  type="button"
                  className={`self-start rounded border px-3 py-1.5 text-[12px] font-bold cursor-pointer ${mode === "merge" ? "border-teal bg-teal text-navy" : "border-red bg-red text-white"}`}
                  onClick={() => setConfirming(true)}
                >
                  {mode === "merge" ? "Juntar" : "Eliminar"}
                </button>
              )}

              {canApply && confirming && (
                <div className="bg-red/10 border border-red/30 rounded-md p-2.5">
                  <div className="text-[12px] mb-2">
                    {mode === "merge" ? (
                      <>
                        ¿Seguro? <b>{preview.removed.name}</b> desaparece y todo pasa a <b>{preview.official?.name}</b>. <b>No se puede deshacer.</b>
                      </>
                    ) : (
                      <>
                        ¿Seguro? <b>{preview.removed.name}</b> se borra para siempre. <b>No se puede deshacer.</b>
                      </>
                    )}
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      disabled={busy}
                      className="rounded border border-red bg-red px-2.5 py-1 text-[11.5px] font-bold text-white cursor-pointer disabled:opacity-60"
                      onClick={apply}
                    >
                      {busy ? "Procesando…" : mode === "merge" ? "Sí, juntar" : "Sí, eliminar"}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      className="rounded border border-rule px-2.5 py-1 text-[11.5px] font-semibold cursor-pointer disabled:opacity-60"
                      onClick={() => setConfirming(false)}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {err && <div className="text-red text-[12px]">{err}</div>}

          {history.length > 0 && (
            <div>
              <button
                type="button"
                className="flex items-center gap-1 text-[11px] font-semibold text-steel hover:text-teal cursor-pointer"
                onClick={() => setShowHistory((s) => !s)}
              >
                {showHistory ? <ChevronUp size={12} /> : <ChevronDown size={12} />} Historial ({history.length})
              </button>
              {showHistory && (
                <div className="mt-1.5 flex flex-col gap-1 max-h-48 overflow-y-auto">
                  {history.map((h) => (
                    <div key={h.id} className="text-[11px] text-steel">
                      <span className="font-mono">{formatDateTime(h.performedAt)}</span> — <span className="font-semibold text-ink">{h.performedByName}</span>{" "}
                      {h.kind === "MERGE" ? (
                        <>
                          juntó <b>{h.removedName}</b> ({h.removedJustCode ?? "sin código"}) con <b>{h.officialName}</b> ({h.officialJustCode ?? "sin código"})
                        </>
                      ) : (
                        <>
                          eliminó <b>{h.removedName}</b> ({h.removedJustCode ?? "sin código"})
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
