"use client";

import { useEffect, useState } from "react";
import { Upload, CheckCircle2, AlertTriangle, ChevronDown, ChevronUp, Package, Search } from "lucide-react";
import { uploadFile } from "@/lib/uploadFile";

type RocketTarget = { type: "product" | "combo"; id: string; name: string; componentsCount: number | null };
type ReadyRow = { code: string; name: string; quantity: number; target: RocketTarget };
type SuggestedRow = { code: string; name: string; quantity: number; suggestion: RocketTarget; matchType: "exact" | "similar" };
type UnmatchedRow = { code: string; name: string; quantity: number };
type Candidate = { type: "product" | "combo"; id: string; name: string; componentsCount: number | null };
type Preview = { totalRows: number; readyRows: ReadyRow[]; suggestedRows: SuggestedRow[]; unmatchedRows: UnmatchedRow[]; candidates: Candidate[] };

type CompiledLine = { catalogItemId: string; name: string; photos: string[]; quantity: number };
type CompiledBatch = { id: string; source: string; requestedAt: string; requestedByName: string; totalRows: number; skippedCount: number; lines: CompiledLine[] };

type BatchListItem = { id: string; source: string; requestedAt: string; requestedByName: string; totalRows: number; skippedCount: number; lineCount: number };

type Decision = { target: Candidate | null; skip: boolean };

function fmt(iso: string) {
  return new Date(iso).toLocaleString("es-EC", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function TargetBadge({ target }: { target: RocketTarget | Candidate }) {
  const broken = target.type === "combo" && target.componentsCount === 0;
  return (
    <span
      className={`font-mono text-[9px] font-bold uppercase rounded-full px-1.5 py-0.5 border ${
        broken ? "bg-red/15 border-red/40 text-red" : target.type === "combo" ? "bg-gold/15 border-gold/40" : "bg-teal/15 border-teal/40 text-teal"
      }`}
      style={broken ? undefined : target.type === "combo" ? { color: "#D9A441" } : undefined}
    >
      {target.type === "combo" ? (broken ? "Combo sin receta" : "Combo") : "Producto"}
    </span>
  );
}

// Buscador inline compartido por filas sugeridas (rechazadas) y sin
// coincidencia — misma lista de candidatos (productos + combos) filtrada en
// el navegador, mismo criterio que ProductMatchPicker.
function ManualSearch({ candidates, onPick }: { candidates: Candidate[]; onPick: (c: Candidate) => void }) {
  const [q, setQ] = useState("");
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const results = words.length === 0 ? [] : candidates.filter((c) => words.every((w) => c.name.toLowerCase().includes(w))).slice(0, 6);
  return (
    <div className="mt-1.5">
      <div className="relative">
        <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-steel" />
        <input
          className="w-full max-w-xs rounded border border-rule pl-6.5 pr-2 py-1 text-[11.5px]"
          placeholder="Buscar producto o combo…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {results.length > 0 && (
        <div className="mt-1 flex flex-col gap-1">
          {results.map((c) => (
            <button
              key={`${c.type}:${c.id}`}
              type="button"
              className="text-left text-[11.5px] flex items-center gap-1.5 rounded px-1.5 py-1 hover:bg-teal/10 cursor-pointer"
              onClick={() => onPick(c)}
            >
              <TargetBadge target={c} />
              {c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CompiledResult({ batch }: { batch: CompiledBatch }) {
  return (
    <div className="bg-surface border border-rule rounded-md p-4 mb-5">
      <div className="flex items-center gap-1.5 text-teal text-[13px] font-bold mb-1">
        <CheckCircle2 size={15} /> Compendiado listo
      </div>
      <div className="text-[11.5px] text-steel mb-3">
        {fmt(batch.requestedAt)} · subido por {batch.requestedByName} · {batch.totalRows} filas del archivo
        {batch.skippedCount > 0 ? `, ${batch.skippedCount} ignoradas` : ""} → {batch.lines.length} productos reales distintos.
      </div>
      <div className="flex flex-col gap-1.5 max-h-96 overflow-y-auto">
        {batch.lines.map((l) => (
          <div key={l.catalogItemId} className="flex items-center gap-2.5 bg-cloud rounded-md px-3 py-2">
            {l.photos[0] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={l.photos[0]} alt="" className="w-7 h-7 object-cover rounded border border-rule shrink-0" />
            ) : (
              <div className="w-7 h-7 rounded border border-dashed border-rule shrink-0 flex items-center justify-center text-steel">
                <Package size={12} />
              </div>
            )}
            <span className="text-[12.5px] flex-1 min-w-0 truncate">{l.name}</span>
            <span className="font-mono text-[13px] font-bold text-teal shrink-0">{l.quantity}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function RocketRequestPanel({ canSubmit }: { canSubmit: boolean }) {
  const [phase, setPhase] = useState<"idle" | "reading" | "preview" | "applying">("idle");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [err, setErr] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState<CompiledBatch | null>(null);
  const [history, setHistory] = useState<BatchListItem[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  function loadHistory() {
    fetch("/api/fulfillment-requests")
      .then((r) => (r.ok ? r.json() : []))
      .then(setHistory)
      .catch(() => setHistory([]));
  }
  useEffect(loadHistory, []);

  async function handleFile(file: File) {
    setErr("");
    setResult(null);
    setPhase("reading");
    const uploaded = await uploadFile(file, "rocket-request-import");
    if (!uploaded.ok) {
      setErr(uploaded.error);
      setPhase("idle");
      return;
    }
    const res = await fetch("/api/fulfillment-requests/rocket/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileUrl: uploaded.url }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(json?.error ?? "No se pudo leer el archivo.");
      setPhase("idle");
      return;
    }
    const p = json.preview as Preview;
    setPreview(p);
    setWarnings(json.warnings ?? []);
    const initial: Record<string, Decision> = {};
    for (const r of p.suggestedRows) {
      const usable = !(r.suggestion.type === "combo" && r.suggestion.componentsCount === 0);
      initial[r.code] = { target: r.matchType === "exact" && usable ? r.suggestion : null, skip: false };
    }
    for (const r of p.unmatchedRows) initial[r.code] = { target: null, skip: false };
    setDecisions(initial);
    setPhase("preview");
  }

  function cancelPreview() {
    setPreview(null);
    setPhase("idle");
    setErr("");
  }

  const pendingCount = preview
    ? [...preview.suggestedRows.map((r) => r.code), ...preview.unmatchedRows.map((r) => r.code)].filter((code) => {
        const d = decisions[code];
        return !d || (!d.target && !d.skip);
      }).length
    : 0;

  async function confirmApply() {
    if (!preview) return;
    setPhase("applying");
    setErr("");
    const rows: { code: string; name: string; quantity: number; targetType: "product" | "combo"; targetId: string; createMapping: boolean }[] = [];
    let skippedCount = 0;
    for (const r of preview.readyRows) {
      rows.push({ code: r.code, name: r.name, quantity: r.quantity, targetType: r.target.type, targetId: r.target.id, createMapping: false });
    }
    for (const r of [...preview.suggestedRows, ...preview.unmatchedRows]) {
      const d = decisions[r.code];
      if (!d) continue;
      if (d.skip) {
        skippedCount++;
        continue;
      }
      if (d.target) rows.push({ code: r.code, name: r.name, quantity: r.quantity, targetType: d.target.type, targetId: d.target.id, createMapping: true });
    }

    const res = await fetch("/api/fulfillment-requests/rocket/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ totalRows: preview.totalRows, rows, skippedCount }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(json?.error ?? "No se pudo aplicar la subida.");
      setPhase("preview");
      return;
    }
    setPreview(null);
    setPhase("idle");
    loadHistory();
    const detail = await fetch(`/api/fulfillment-requests/${json.batchId}`).then((r) => (r.ok ? r.json() : null));
    setResult(detail);
  }

  function setDecision(code: string, d: Decision) {
    setDecisions((prev) => ({ ...prev, [code]: d }));
  }

  async function viewBatch(id: string) {
    const detail = await fetch(`/api/fulfillment-requests/${id}`).then((r) => (r.ok ? r.json() : null));
    if (detail) setResult(detail);
  }

  return (
    <div>
      {canSubmit && (
        <div className="text-[12.5px] mb-3 bg-teal/10 border border-teal/25 rounded px-2.5 py-2">
          <b>Qué hacer aquí:</b> descarga de Rocket el Excel con lo que hay que despachar (código, producto y cantidad) y súbelo abajo. DAFLOW reconoce solo los códigos que ya vinculaste antes; los nuevos te los muestra para que confirmes a qué producto o combo corresponden — la próxima vez ya no te pregunta por ese mismo código.
        </div>
      )}

      {result && <CompiledResult batch={result} />}

      {canSubmit && phase === "idle" && (
        <label
          className={`flex flex-col items-center justify-center gap-1.5 border-[1.5px] border-dashed rounded-md py-6 cursor-pointer transition-colors mb-5 ${dragOver ? "border-teal bg-teal/10" : "border-rule hover:border-teal"}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) handleFile(file);
          }}
        >
          <Upload size={20} className="text-steel" />
          <div className="text-[13px] font-semibold">Subir Excel de Rocket</div>
          <div className="text-[11px] text-steel">Formato .xlsx o .xls — código, producto y cantidad, o arrastra el archivo aquí</div>
          <input type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
        </label>
      )}

      {phase === "reading" && (
        <div className="flex items-center justify-center gap-2.5 py-6 text-steel text-[13px] mb-5">
          <span className="w-4 h-4 rounded-full border-2 border-rule border-t-teal animate-spin" /> Leyendo archivo…
        </div>
      )}

      {err && <div className="text-red text-[12.5px] mb-3">{err}</div>}

      {(phase === "preview" || phase === "applying") && preview && (
        <div className="bg-surface border border-rule rounded-md p-4 mb-5">
          <div className="font-display font-bold text-[14.5px] mb-3">Revisa antes de aplicar</div>

          <div className="flex flex-wrap gap-2 mb-3.5">
            <span className="font-mono text-[10.5px] bg-teal/15 border border-teal/40 text-teal rounded-full px-2.5 py-1">{preview.readyRows.length} ya reconocidos</span>
            {preview.suggestedRows.length + preview.unmatchedRows.length > 0 && (
              <span className="font-mono text-[10.5px] bg-gold/15 border border-gold/40 rounded-full px-2.5 py-1" style={{ color: "#D9A441" }}>
                {preview.suggestedRows.length + preview.unmatchedRows.length} necesitan tu confirmación
              </span>
            )}
          </div>

          {warnings.length > 0 && (
            <div className="flex flex-col gap-1 mb-3.5">
              {warnings.map((w, i) => (
                <div key={i} className="text-[11.5px] flex items-start gap-1.5 text-steel">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {w}
                </div>
              ))}
            </div>
          )}

          {[...preview.suggestedRows.map((r) => ({ ...r, kind: "suggested" as const })), ...preview.unmatchedRows.map((r) => ({ ...r, kind: "unmatched" as const, suggestion: null, matchType: null }))].map(
            (r) => {
              const d = decisions[r.code] ?? { target: null, skip: false };
              const resolved = !!d.target || d.skip;
              return (
                <div key={r.code} className={`mb-2.5 rounded-md p-2.5 ${resolved ? "bg-cloud" : "bg-gold/10 border border-gold/30"}`}>
                  <div className="text-[11.5px] mb-1.5 flex items-center gap-1.5 flex-wrap">
                    <span className="font-mono text-steel">{r.code}</span>
                    <span>
                      <b>{r.name}</b> — cantidad pedida: <b>{r.quantity}</b>
                    </span>
                    {r.kind === "suggested" && r.suggestion && (
                      <>
                        <span>→ parece ser</span>
                        <TargetBadge target={r.suggestion} />
                        <span>
                          <b>{r.suggestion.name}</b>
                        </span>
                        {r.matchType === "similar" && <span className="text-[9.5px] text-steel">(palabras parecidas — revisa)</span>}
                      </>
                    )}
                  </div>

                  {r.kind === "suggested" && r.suggestion && !(r.suggestion.type === "combo" && r.suggestion.componentsCount === 0) && (
                    <div className="flex gap-1.5 mb-1">
                      <button
                        type="button"
                        className={`text-[11px] font-semibold rounded-full px-2.5 py-1 border cursor-pointer ${d.target?.id === r.suggestion.id ? "border-teal text-teal bg-teal/15" : "border-rule text-steel"}`}
                        onClick={() => setDecision(r.code, { target: r.suggestion!, skip: false })}
                      >
                        Sí, es este
                      </button>
                      <button
                        type="button"
                        className={`text-[11px] font-semibold rounded-full px-2.5 py-1 border cursor-pointer ${d.target && d.target.id !== r.suggestion.id ? "border-teal text-teal bg-teal/15" : "border-rule text-steel"}`}
                        onClick={() => setDecision(r.code, { target: null, skip: false })}
                      >
                        No, buscar otro
                      </button>
                    </div>
                  )}

                  {r.kind === "suggested" && r.suggestion?.type === "combo" && r.suggestion.componentsCount === 0 && (
                    <div className="text-[11px] text-red mb-1 flex items-center gap-1">
                      <AlertTriangle size={12} /> Este combo no tiene receta registrada — no se puede calcular la cantidad real. Búscalo de nuevo abajo o ignóralo, y pide que registren su receta en &quot;Base de datos de productos&quot;.
                    </div>
                  )}

                  {(!d.target || (r.kind === "suggested" && r.suggestion && d.target.id !== r.suggestion.id)) && !d.skip && (
                    <ManualSearch candidates={preview.candidates} onPick={(c) => setDecision(r.code, { target: c, skip: false })} />
                  )}

                  {d.target && (!r.suggestion || d.target.id !== r.suggestion.id) && (
                    <div className="text-[11px] mt-1 flex items-center gap-1.5">
                      Elegido: <TargetBadge target={d.target} /> <b>{d.target.name}</b>
                      <button type="button" className="text-steel hover:text-red cursor-pointer ml-1" onClick={() => setDecision(r.code, { target: null, skip: false })}>
                        Quitar
                      </button>
                    </div>
                  )}

                  <button
                    type="button"
                    className={`text-[10.5px] mt-1.5 cursor-pointer ${d.skip ? "text-red font-semibold" : "text-steel hover:text-red"}`}
                    onClick={() => setDecision(r.code, { target: null, skip: !d.skip })}
                  >
                    {d.skip ? "✓ Marcado como \"no es un producto\" (ignorar)" : "No es un producto — ignorar esta fila"}
                  </button>
                </div>
              );
            }
          )}

          <div className="flex items-center gap-2.5 mt-2">
            <button
              type="button"
              disabled={phase === "applying" || pendingCount > 0}
              className="rounded border border-teal bg-teal px-3.5 py-2 text-[12.5px] font-bold text-navy cursor-pointer disabled:opacity-60"
              onClick={confirmApply}
            >
              {phase === "applying" ? "Aplicando…" : "Confirmar y compendiar"}
            </button>
            <button type="button" className="text-steel text-[12.5px] cursor-pointer" onClick={cancelPreview}>
              Cancelar
            </button>
            {pendingCount > 0 && (
              <span className="text-[11.5px]" style={{ color: "#D9A441" }}>
                Resuelve las {pendingCount} fila(s) pendientes antes de aplicar.
              </span>
            )}
          </div>
        </div>
      )}

      {history && history.length > 0 && (
        <div>
          <button type="button" className="flex items-center gap-1 text-[11px] font-semibold text-steel hover:text-teal cursor-pointer" onClick={() => setShowHistory((s) => !s)}>
            {showHistory ? <ChevronUp size={12} /> : <ChevronDown size={12} />} Historial de subidas ({history.length})
          </button>
          {showHistory && (
            <div className="mt-2 flex flex-col gap-1">
              {history.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  className="text-left text-[11px] text-steel hover:text-teal cursor-pointer flex flex-wrap items-center gap-x-1.5"
                  onClick={() => viewBatch(b.id)}
                >
                  <span className="font-mono">{fmt(b.requestedAt)}</span>
                  <span>—</span>
                  <span className="font-semibold">{b.requestedByName}</span>
                  <span>· {b.source === "ROCKET" ? "Rocket" : "Dropi"} · {b.totalRows} filas{b.skippedCount > 0 ? `, ${b.skippedCount} ignoradas` : ""}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
