"use client";

import { useEffect, useState, useCallback } from "react";
import { CheckCircle2, Copy, Check, TrendingUp, TrendingDown, Sparkles } from "lucide-react";

type CatalogRef = { id: string; name: string; justCode: string | null; photos: string[]; nicho: string | null };
type Item = { id: string; catalogItemId: string; quantity: number; role: "WINNER" | "LOW"; fromComboCode: string | null; catalogItem: CatalogRef };
type Formula = {
  parts: { catalogItemId: string; quantity: number; unitCost: number; insuranceRatePercent: number; withInsurance: number; subtotal: number }[];
  fulfillment: number;
  benistock: number;
  marginPercent: number;
};
type Pricing = {
  formula: Formula | null;
  dropiPrice: number | null;
  separatePrice: number | null;
  missingCostItemIds: string[];
  referenceStock: number | null;
  limitingItemId: string | null;
  recommendedStock: number | null;
};
type Marca = "MKT_PROVEDIX" | "MKT_DAMIAN" | "MKT_SHANGHAI";
type Suggestion = {
  id: string;
  nicho: string;
  matchScore: number | null;
  suggestedName: string | null;
  aiReason: string | null;
  bodega: Marca | null;
  approvedDropiPrice: number | null;
  status: "SUGERIDO" | "SELECCIONADO" | "PENDIENTE_APROBACION" | "APROBADO" | "RECHAZADO" | "CREADO_EN_DROPI";
  rejectReason: string | null;
  items: Item[];
  dropiCombo: { code: string } | null;
  pricing: Pricing | null;
  selectedBy: { name: string } | null;
  reviewedBy: { name: string } | null;
  createdInDropiBy: { name: string } | null;
};

const MARCA_LABELS: Record<Marca, string> = {
  MKT_PROVEDIX: "Provedix",
  MKT_DAMIAN: "Importadora Damián",
  MKT_SHANGHAI: "Importadora Shanghai",
};

const money = (n: number) => `$${n.toFixed(2)}`;

// Confirmado 2026-09-03: qué tan probable es, según la IA, que el combo se
// venda bien.
function MatchScoreBadge({ score }: { score: number | null }) {
  if (score === null) return null;
  const color = score >= 80 ? "#3FB98C" : score >= 60 ? "#D9A441" : "#C4665A";
  return (
    <span className="text-[10px] font-bold rounded-full px-1.5 py-0.5" style={{ color, border: `1px solid ${color}` }}>
      {score}% probable
    </span>
  );
}

// Pedido del usuario 2026-09-30: todo listo para copiar y pegar en Dropi
// con un solo clic.
function CopyField({ label, value, hint, onValueClick }: { label: string; value: string; hint?: string; onValueClick?: () => void }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Sin permiso de portapapeles: el valor sigue visible para copiarlo a mano.
    }
  }
  return (
    <div className="flex flex-col gap-0.5 min-w-[150px]">
      {/* Pedido del usuario 2026-10-05: títulos resaltados. */}
      <div className="text-[11.5px] font-bold uppercase tracking-wide text-teal">{label}</div>
      <div className="flex items-center gap-1.5">
        {onValueClick ? (
          <button type="button" onClick={onValueClick} title="Ver cómo se calculó" className="text-[14px] font-bold text-ink underline decoration-dotted underline-offset-2 cursor-pointer hover:text-teal">
            {value}
          </button>
        ) : (
          <span className="text-[14px] font-bold text-ink">{value}</span>
        )}
        <button type="button" onClick={copy} className="inline-flex items-center gap-1 rounded border border-rule px-1.5 py-0.5 text-[10.5px] font-semibold text-steel cursor-pointer hover:border-teal hover:text-teal">
          {copied ? <Check size={11} /> : <Copy size={11} />} {copied ? "Copiado" : "Copiar"}
        </button>
      </div>
      {hint && <div className="text-[10.5px] text-steel">{hint}</div>}
    </div>
  );
}

// Ganadores con flecha arriba, el de baja salida con flecha abajo — color y
// palabra fija, no solo color (pedido 2026-09-03).
function Products({ s }: { s: Suggestion }) {
  const missing = new Set(s.pricing?.missingCostItemIds ?? []);
  return (
    <div className="flex flex-col gap-0.5 text-[12.5px]">
      {s.items.map((it) => {
        const winner = it.role === "WINNER";
        return (
          <div key={it.id} className="flex flex-wrap items-center gap-1.5">
            <span className={`inline-flex items-center gap-1 font-semibold ${winner ? "text-teal" : ""}`} style={winner ? undefined : { color: "var(--color-gold)" }}>
              {winner ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
              {it.quantity > 1 ? `${it.quantity} × ` : ""}
              {it.catalogItem.name}
            </span>
            {/* Pedido del usuario 2026-10-05: ID de Dropi de cada producto del combo. */}
            <span className="text-[10.5px] font-semibold text-ink bg-cloud rounded px-1.5">{it.catalogItem.justCode ? `ID ${it.catalogItem.justCode}` : "sin ID"}</span>
            <span className="text-[10px] text-steel">
              ({winner ? "ganador" : "baja salida"}{it.fromComboCode ? ` · viene del combo ${it.fromComboCode}` : ""})
            </span>
            {s.pricing?.limitingItemId === it.catalogItemId && <span className="text-[10px] font-semibold" style={{ color: "var(--color-gold)" }}>← limita el stock</span>}
            {missing.has(it.catalogItemId) && <span className="text-[10px] font-semibold text-red">sin costo todavía</span>}
          </div>
        );
      })}
    </div>
  );
}

function Header({ s }: { s: Suggestion }) {
  return (
    <div className="flex flex-wrap items-center gap-2 mb-1.5">
      <span className="inline-flex items-center gap-1 text-[14px] font-bold">
        <Sparkles size={13} className="text-teal" /> {s.suggestedName ?? "Combo sin nombre"}
      </span>
      <span className="text-[11px] text-steel">
        {s.items.length} productos · {s.nicho}
      </span>
      <MatchScoreBadge score={s.matchScore} />
    </div>
  );
}

// Pedido del usuario 2026-10-03: por qué la IA cree que este combo puede
// ganar, para que la asesora y Bryan decidan con esa información.
function AiReason({ s }: { s: Suggestion }) {
  if (!s.aiReason) return null;
  return (
    <div className="mt-1.5 text-[11.5px] leading-relaxed bg-cloud rounded px-2.5 py-1.5">
      <b className="text-ink">Por qué puede ganar:</b> <span className="text-steel">{s.aiReason}</span>
    </div>
  );
}

// Pedido del usuario 2026-10-05: al pulsar el precio Dropi se ve la fórmula
// con los productos del combo (misma cuenta que computeComboDropiPrice).
function PriceFormula({ s, shownPrice }: { s: Suggestion; shownPrice: number }) {
  const f = s.pricing?.formula;
  if (!f) return <div className="mt-2 text-[11.5px] text-steel bg-cloud rounded px-2.5 py-2">No se puede mostrar la fórmula: falta el costo de algún producto.</div>;
  const nameById = new Map(s.items.map((it) => [it.catalogItemId, it.catalogItem]));
  const live = Math.round((f.benistock / (1 - f.marginPercent / 100)) * 100) / 100;
  return (
    <div className="mt-2 text-[11.5px] bg-cloud rounded px-3 py-2.5 flex flex-col gap-1">
      <div className="font-bold text-ink">Cómo se calculó el precio Dropi</div>
      {f.parts.map((p) => {
        const c = nameById.get(p.catalogItemId);
        return (
          <div key={p.catalogItemId} className="text-steel">
            <b className="text-ink">{c?.name ?? "Producto"}</b>
            {c?.justCode && <> (ID {c.justCode})</>}: costo {money(p.unitCost)} + seguro {p.insuranceRatePercent}% = {money(p.withInsurance)}
            {p.quantity > 1 && <> × {p.quantity}</>} → <b className="text-ink">{money(p.subtotal)}</b>
          </div>
        );
      })}
      <div className="text-steel">+ fulfillment (una sola vez por combo) → <b className="text-ink">{money(f.fulfillment)}</b></div>
      <div className="text-steel border-t border-rule pt-1">
        Costo total del combo = <b className="text-ink">{money(f.benistock)}</b>
      </div>
      <div className="text-steel">
        Precio Dropi = {money(f.benistock)} ÷ (1 − {f.marginPercent}%) = {money(f.benistock)} ÷ {(1 - f.marginPercent / 100).toFixed(2)} = <b className="text-ink">{money(live)}</b>
      </div>
      {Math.abs(live - shownPrice) >= 0.01 && (
        <div className="text-[10.5px]" style={{ color: "var(--color-gold)" }}>
          El precio aprobado ({money(shownPrice)}) quedó fijo al aprobarse; con los costos de hoy daría {money(live)}.
        </div>
      )}
    </div>
  );
}

function PriceLine({ s, price }: { s: Suggestion; price: number | null }) {
  const p = s.pricing;
  if (price === null) return <div className="text-[11.5px] text-red">Falta el costo de algún producto — no se puede calcular el precio.</div>;
  const saving = p?.separatePrice != null ? p.separatePrice - price : null;
  return (
    <div className="text-[11.5px] text-steel">
      Precio Dropi <b className="text-ink">{money(price)}</b> (margen 20%)
      {saving != null && saving > 0 && <> · por separado {money(p!.separatePrice!)} → el cliente ahorra {money(saving)}</>}
      {p?.referenceStock != null && <> · en bodega alcanza para ≈ {p.referenceStock}</>}
    </div>
  );
}

// Pedido del usuario 2026-09-30 (rediseño): los combos se arman solos cada
// noche. La asesora B2B no cambia nada — solo elige cuáles mandar según su
// propio análisis. El líder de Análisis de Mercado aprueba o rechaza CADA
// combo y elige UNA marca (un combo nunca se repite en otra marca). Con el
// combo aprobado, la asesora B2B copia nombre, precio y stock a Dropi, pega
// el ID que le dio Dropi, y el combo queda solo en Stock Actual y en
// "Nuevos IDs por brandear".
export function ComboSuggestionsBoard({ canApprove, canAct, canMarkCreated }: { canApprove: boolean; canAct: boolean; canMarkCreated: boolean }) {
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [brandById, setBrandById] = useState<Record<string, Marca | "">>({});
  const [codeById, setCodeById] = useState<Record<string, string>>({});
  const [formulaOpen, setFormulaOpen] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    const res = await fetch("/api/combo-suggestions");
    const data = await res.json().catch(() => null);
    if (res.ok) setSuggestions(data.suggestions);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const suggested = (suggestions ?? [])
    .filter((s) => s.status === "SUGERIDO" || s.status === "SELECCIONADO")
    .sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0));
  const pendingApproval = (suggestions ?? []).filter((s) => s.status === "PENDIENTE_APROBACION");
  const approved = (suggestions ?? []).filter((s) => s.status === "APROBADO");
  const created = (suggestions ?? []).filter((s) => s.status === "CREADO_EN_DROPI");
  const sendable = (s: Suggestion) => s.pricing?.dropiPrice != null;

  // Pedido del usuario (2026-09-04): marcar de un clic todas las de un mismo
  // color de probabilidad.
  function selectByTier(min: number, max: number) {
    setChecked((prev) => {
      const next = new Set(prev);
      for (const s of suggested) {
        const score = s.matchScore ?? 0;
        if (score >= min && score <= max && sendable(s)) next.add(s.id);
      }
      return next;
    });
  }

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function post(url: string, body: unknown, fallback: string): Promise<boolean> {
    setBusy(true);
    setErr("");
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      setErr(data?.error ?? fallback);
      return false;
    }
    return true;
  }

  async function submitBatch() {
    if (checked.size === 0) return;
    if (await post("/api/combo-suggestions/submit-batch", { ids: [...checked] }, "No se pudo enviar.")) {
      setChecked(new Set());
      load();
    }
  }

  async function review(id: string, action: "approve" | "reject") {
    const body = action === "approve" ? { action, bodega: brandById[id] } : { action, rejectReason: rejectReason.trim() || undefined };
    if (await post(`/api/combo-suggestions/${id}/review`, body, "No se pudo revisar.")) {
      setRejecting(null);
      setRejectReason("");
      load();
    }
  }

  async function markCreated(id: string) {
    if (await post(`/api/combo-suggestions/${id}/mark-created`, { dropiCode: (codeById[id] ?? "").trim() }, "No se pudo guardar.")) load();
  }

  if (suggestions === null) return <div className="text-[12.5px] text-steel">Cargando…</div>;

  const sendButton = (cls: string) => (
    <button type="button" disabled={busy || checked.size === 0} className={cls} onClick={submitBatch}>
      Enviar {checked.size > 0 ? `(${checked.size}) ` : ""}a aprobación
    </button>
  );

  return (
    <div className="flex flex-col gap-5">
      {err && <div className="text-red text-[12.5px]">{err}</div>}

      {canApprove && pendingApproval.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-2">
            {canAct ? "Pendientes de tu aprobación — elige la marca de cada uno" : "Pendientes de aprobación"}
          </div>
          <div className="flex flex-col gap-2.5">
            {pendingApproval.map((s) => (
              <div key={s.id} className="bg-surface border border-gold/40 rounded-md p-3.5">
                <Header s={s} />
                <Products s={s} />
                <AiReason s={s} />
                <div className="mt-1.5">
                  <PriceLine s={s} price={s.pricing?.dropiPrice ?? null} />
                </div>
                <div className="mt-2.5">
                  {!canAct ? (
                    <div className="text-[11.5px] text-steel">Solo el líder de Análisis de Mercado puede aprobar o rechazar.</div>
                  ) : rejecting === s.id ? (
                    <div className="flex items-center gap-2 flex-wrap">
                      <input
                        type="text"
                        placeholder="Motivo del rechazo (opcional)"
                        className="rounded border border-rule bg-surface px-2.5 py-1.5 text-[12px] flex-1 min-w-[200px]"
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                      />
                      <button type="button" disabled={busy} className="rounded border border-red bg-red px-3 py-1.5 text-[12px] font-bold text-white cursor-pointer" onClick={() => review(s.id, "reject")}>
                        Confirmar rechazo
                      </button>
                      <button type="button" className="text-[11px] text-steel cursor-pointer" onClick={() => setRejecting(null)}>
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-2 flex-wrap items-center">
                      <select
                        className="rounded border border-rule bg-surface px-2 py-1.5 text-[12px]"
                        value={brandById[s.id] ?? ""}
                        onChange={(e) => setBrandById((p) => ({ ...p, [s.id]: e.target.value as Marca | "" }))}
                      >
                        <option value="">— Elige la marca —</option>
                        {(Object.keys(MARCA_LABELS) as Marca[]).map((m) => (
                          <option key={m} value={m}>
                            {MARCA_LABELS[m]}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={busy || !brandById[s.id]}
                        className="rounded border border-teal bg-teal px-3.5 py-1.5 text-[12px] font-bold text-navy cursor-pointer disabled:opacity-60"
                        onClick={() => review(s.id, "approve")}
                      >
                        Aprobar
                      </button>
                      <button type="button" disabled={busy} className="rounded border border-rule px-3.5 py-1.5 text-[12px] font-semibold cursor-pointer" onClick={() => setRejecting(s.id)}>
                        Rechazar
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {approved.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-2">Aprobados — listos para copiar a Dropi</div>
          <div className="flex flex-col gap-2.5">
            {approved.map((s) => {
              const p = s.pricing;
              const price = s.approvedDropiPrice ?? p?.dropiPrice ?? null;
              return (
                <div key={s.id} className="bg-surface border border-teal/40 rounded-md p-3.5">
                  <div className="text-[11.5px] text-steel mb-2">
                    Subir en <b className="text-ink">{s.bodega ? MARCA_LABELS[s.bodega] : "—"}</b>
                    {s.reviewedBy && <> · aprobado por {s.reviewedBy.name}</>}
                  </div>
                  <div className="flex flex-wrap gap-x-6 gap-y-2.5 mb-2.5">
                    <CopyField label="Nombre" value={s.suggestedName ?? ""} />
                    {price !== null && (
                      <CopyField
                        label="Precio Dropi"
                        value={price.toFixed(2)}
                        hint="Gana mínimo 20% · toca el precio para ver la fórmula"
                        onValueClick={() => setFormulaOpen((o) => ({ ...o, [s.id]: !o[s.id] }))}
                      />
                    )}
                    {p?.recommendedStock != null && (
                      <CopyField label="Stock para Dropi" value={String(p.recommendedStock)} hint={`Real en bodega: alcanza para ${p.referenceStock} · recomendado`} />
                    )}
                  </div>
                  {price !== null && formulaOpen[s.id] && (
                    <div className="mb-2.5">
                      <PriceFormula s={s} shownPrice={price} />
                    </div>
                  )}
                  <Products s={s} />
                  <div className="mt-3 pt-2.5 border-t border-rule">
                    {canMarkCreated ? (
                      <div className="flex items-center gap-2 flex-wrap">
                        <input
                          type="text"
                          inputMode="numeric"
                          placeholder="ID que te dio Dropi"
                          className="rounded border border-rule bg-surface px-2.5 py-1.5 text-[12px] w-[180px]"
                          value={codeById[s.id] ?? ""}
                          onChange={(e) => setCodeById((c) => ({ ...c, [s.id]: e.target.value }))}
                        />
                        <button
                          type="button"
                          disabled={busy || !(codeById[s.id] ?? "").trim()}
                          className="rounded border border-teal bg-teal px-3 py-1.5 text-[12px] font-bold text-navy cursor-pointer disabled:opacity-60"
                          onClick={() => markCreated(s.id)}
                        >
                          Creado en Dropi
                        </button>
                        <span className="text-[11px] text-steel">Queda registrado solo en Stock Actual y pasa a brandeo.</span>
                      </div>
                    ) : (
                      <span className="text-[11.5px] text-steel">Esperando a que la asesora B2B lo cree en Dropi.</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-steel">Combos sugeridos</div>
        </div>
        <div className="text-[11.5px] text-steel mb-2">
          Se arman solos cada lunes con los productos ganadores reales: 1 ganador + 1 de baja salida, o 2 ganadores + 1 que casi no se mueve, siempre del mismo nicho. La lista queda toda la semana; el próximo lunes se renueva y lo que no se mandó a aprobación sale de la lista.
          {canMarkCreated ? " Elige cuáles mandar a aprobación." : " La asesora B2B elige cuáles mandar a aprobación."}
        </div>
        {suggested.length === 0 ? (
          <div className="border-[1.5px] border-dashed border-rule rounded-md p-6 text-center text-steel text-[12.5px]">No hay combos sugeridos esta semana. La próxima lista sale el lunes.</div>
        ) : (
          <>
            {canMarkCreated && (
              <div className="flex items-center gap-2 mb-2 text-[11px] flex-wrap">
                <span className="text-steel">Marcar de una:</span>
                <button type="button" className="rounded-full px-2 py-0.5 font-semibold cursor-pointer" style={{ color: "#3FB98C", border: "1px solid #3FB98C" }} onClick={() => selectByTier(80, 100)}>
                  Verdes (≥80%)
                </button>
                <button type="button" className="rounded-full px-2 py-0.5 font-semibold cursor-pointer" style={{ color: "#D9A441", border: "1px solid #D9A441" }} onClick={() => selectByTier(60, 79)}>
                  Naranjas (60-79%)
                </button>
                <button type="button" className="rounded-full px-2 py-0.5 font-semibold cursor-pointer" style={{ color: "#C4665A", border: "1px solid #C4665A" }} onClick={() => selectByTier(0, 59)}>
                  Rojas (&lt;60%)
                </button>
                {checked.size > 0 && (
                  <button type="button" className="text-steel underline cursor-pointer" onClick={() => setChecked(new Set())}>
                    Limpiar selección
                  </button>
                )}
                {sendButton("ml-auto rounded border border-teal bg-teal px-3 py-1 text-[11px] font-bold text-navy cursor-pointer disabled:opacity-60")}
              </div>
            )}
            <div className="flex flex-col gap-1.5 mb-2.5">
              {suggested.map((s) => (
                <div key={s.id} className="flex items-start gap-2.5 border border-rule rounded p-2.5">
                  {canMarkCreated && (
                    <input
                      type="checkbox"
                      className="cursor-pointer mt-1 disabled:cursor-not-allowed"
                      disabled={!sendable(s)}
                      checked={checked.has(s.id)}
                      onChange={() => toggle(s.id)}
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <Header s={s} />
                    <Products s={s} />
                    <AiReason s={s} />
                    <div className="mt-1">
                      <PriceLine s={s} price={s.pricing?.dropiPrice ?? null} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {canMarkCreated && sendButton("rounded border border-teal bg-teal px-3.5 py-2 text-[12.5px] font-bold text-navy cursor-pointer disabled:opacity-60")}
          </>
        )}
      </div>

      {created.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-2">Ya creados en Dropi</div>
          <div className="flex flex-col gap-1.5">
            {created.map((s) => (
              <div key={s.id} className="flex items-center gap-2 text-[12px] text-steel flex-wrap">
                <CheckCircle2 size={13} className="text-teal shrink-0" />
                {/* Los creados con el sistema anterior no tienen nombre: se
                    muestran sus productos. */}
                <b className="text-ink">{s.suggestedName ?? s.items.map((it) => it.catalogItem.name).join(" + ")}</b>
                {s.dropiCombo && <span>· ID {s.dropiCombo.code}</span>}
                {s.bodega && <span>· {MARCA_LABELS[s.bodega]}</span>}
                {s.approvedDropiPrice != null && <span>· {money(s.approvedDropiPrice)}</span>}
                {s.createdInDropiBy && <span>· {s.createdInDropiBy.name}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
