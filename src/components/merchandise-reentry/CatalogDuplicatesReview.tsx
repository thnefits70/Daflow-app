"use client";

import { useEffect, useState } from "react";
import { Copy } from "lucide-react";
import type { DuplicateCandidate, DuplicateSide } from "@/lib/catalogDuplicates";

type Step = { pairKey: string; kind: "merge"; officialId: string; resultBalance: number | null; blockers: string[] } | { pairKey: string; kind: "dismiss" };

// Pedido del usuario 2026-10-02: Daniel revisa él mismo los posibles
// productos duplicados (le salen en Inicio) y decide: juntarlos (todo pasa
// al ID que se queda: compras, salidas, stock) o marcar que no son el mismo.
export function CatalogDuplicatesReview() {
  const [rows, setRows] = useState<DuplicateCandidate[] | null>(null);
  const [step, setStep] = useState<Step | null>(null);
  const [keep, setKeep] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");

  function load() {
    fetch("/api/inventory-control/catalog-duplicates")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setRows(Array.isArray(d) ? d : null))
      .catch(() => setRows(null));
  }
  useEffect(load, []);

  async function post(body: object) {
    const res = await fetch("/api/inventory-control/catalog-duplicates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { ok: res.ok, json: await res.json().catch(() => null) };
  }

  async function startMerge(p: DuplicateCandidate) {
    const officialId = keep[p.pairKey] ?? defaultKeep(p);
    const removedId = officialId === p.a.id ? p.b.id : p.a.id;
    setBusy(true);
    setErr("");
    const { ok, json } = await post({ action: "preview", removedId, officialId });
    setBusy(false);
    if (!ok) return setErr(json?.error ?? "No se pudo revisar.");
    setStep({ pairKey: p.pairKey, kind: "merge", officialId, resultBalance: json.preview?.result?.balance ?? null, blockers: json.preview?.blockers ?? [] });
  }

  async function confirm(p: DuplicateCandidate) {
    if (!step) return;
    setBusy(true);
    setErr("");
    const r =
      step.kind === "merge"
        ? await post({ action: "merge", officialId: step.officialId, removedId: step.officialId === p.a.id ? p.b.id : p.a.id })
        : await post({ action: "dismiss", aId: p.a.id, bId: p.b.id });
    setBusy(false);
    setStep(null);
    if (!r.ok) return setErr(r.json?.error ?? "No se pudo guardar.");
    setDone(step.kind === "merge" ? "Productos juntados." : "Listo: no le volverá a salir este par.");
    load();
  }

  if (!rows || (rows.length === 0 && !done)) return null;
  return (
    <section className="border border-gold/50 rounded-md p-3 mb-5">
      <h3 className="font-display text-[15px] font-bold mb-1 flex items-center gap-2">
        <Copy size={15} /> Posibles productos duplicados ({rows.length})
      </h3>
      <p className="text-[12px] text-steel mb-2">
        Tienen el mismo nombre o uno es el otro con algo más. Si son el mismo producto, júntalos: todo (compras, salidas y stock) pasa al ID que se queda. Hazlo antes del conteo físico.
      </p>
      {err && <div className="text-red text-[12.5px] mb-2">{err}</div>}
      {done && <div className="text-teal text-[12.5px] mb-2">{done}</div>}
      <div className="flex flex-col gap-2">
        {rows.map((p) => {
          const kept = keep[p.pairKey] ?? defaultKeep(p);
          const active = step?.pairKey === p.pairKey ? step : null;
          return (
            <div key={p.pairKey} className="border border-rule rounded p-2.5 text-[12.5px]">
              <div className="grid sm:grid-cols-2 gap-2">
                {[p.a, p.b].map((s) => (
                  <label key={s.id} className={`flex items-center gap-2 rounded border p-2 cursor-pointer ${kept === s.id ? "border-teal" : "border-rule"}`}>
                    <input type="radio" name={p.pairKey} checked={kept === s.id} onChange={() => setKeep((k) => ({ ...k, [p.pairKey]: s.id }))} />
                    <Side s={s} />
                  </label>
                ))}
              </div>
              <div className="text-[11.5px] text-steel mt-1">Marcado = el ID que se queda si los juntas.</div>
              {p.newProductNote && <div className="text-[11.5px] text-gold font-semibold mt-1">⚠ {p.newProductNote}</div>}
              {!active && (
                <div className="flex flex-wrap gap-2 mt-2">
                  <button type="button" disabled={busy} className="rounded border border-teal bg-teal px-2.5 py-1 font-bold text-navy cursor-pointer disabled:opacity-60" onClick={() => startMerge(p)}>
                    Son el mismo — juntar
                  </button>
                  <button type="button" disabled={busy} className="rounded border border-rule px-2.5 py-1 font-semibold cursor-pointer" onClick={() => setStep({ pairKey: p.pairKey, kind: "dismiss" })}>
                    No son el mismo
                  </button>
                </div>
              )}
              {active?.kind === "merge" && (
                <div className="mt-2 bg-cloud border border-gold/50 rounded p-2">
                  {active.blockers.length > 0 ? (
                    <div className="text-red">{active.blockers[0]}</div>
                  ) : (
                    <div>
                      ¿Seguro? Se juntan en <b>{[p.a, p.b].find((s) => s.id === active.officialId)?.name}</b>
                      {active.resultBalance != null ? ` y queda con ${active.resultBalance} unidades` : ""}. El otro ID desaparece y no se puede deshacer.
                    </div>
                  )}
                  <div className="flex gap-2 mt-1.5">
                    {active.blockers.length === 0 && (
                      <button type="button" disabled={busy} className="rounded border border-gold bg-gold px-2.5 py-1 font-bold text-navy cursor-pointer" onClick={() => confirm(p)}>
                        {busy ? "Juntando…" : "Sí, juntar"}
                      </button>
                    )}
                    <button type="button" className="text-steel cursor-pointer" onClick={() => setStep(null)}>Cancelar</button>
                  </div>
                </div>
              )}
              {active?.kind === "dismiss" && (
                <div className="mt-2 bg-cloud border border-rule rounded p-2">
                  ¿Confirmas que son productos distintos? Este par no te volverá a salir.
                  <div className="flex gap-2 mt-1.5">
                    <button type="button" disabled={busy} className="rounded border border-gold bg-gold px-2.5 py-1 font-bold text-navy cursor-pointer" onClick={() => confirm(p)}>
                      {busy ? "Guardando…" : "Sí, son distintos"}
                    </button>
                    <button type="button" className="text-steel cursor-pointer" onClick={() => setStep(null)}>Cancelar</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// Por defecto se queda el que tiene ID de Dropi y más stock.
function defaultKeep(p: DuplicateCandidate): string {
  const score = (s: DuplicateSide) => (s.justCode ? 1_000_000 : 0) + s.balance;
  return score(p.a) >= score(p.b) ? p.a.id : p.b.id;
}

function Side({ s }: { s: DuplicateSide }) {
  return (
    <span className="flex items-center gap-2 min-w-0">
      {s.photo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={s.photo} alt="" className="w-9 h-9 rounded object-cover shrink-0" />
      )}
      <span className="min-w-0">
        <b className="block truncate">{s.name}</b>
        <span className="text-steel font-mono text-[11px]">{s.justCode ?? "sin ID"} · stock {s.balance}</span>
      </span>
    </span>
  );
}
