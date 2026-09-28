"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";

type Conflict = { kind: "producto" | "combo"; code: string; name: string; stored: string; manifest: string };

const BRAND: Record<string, string> = {
  MKT_PROVEDIX: "Provedix",
  MKT_DAMIAN: "Importadora Damián",
  MKT_SHANGHAI: "Importadora Shanghai",
  MKT_SUMINISTROS: "Suministros",
};

// Pedido del usuario 2026-09-28 (solo admin): vuelve a leer los manifiestos
// que Yair ya subió para que los IDs sin marca (sobre todo combos) la tomen
// del manifiesto en que vienen. Desde ese día cada subida nueva lo hace sola.
export function ManifestBrandLearner({ onDone }: { onDone: () => void }) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<{ combos: string[]; products: string[]; conflicts: Conflict[]; unread: number } | null>(null);
  const [err, setErr] = useState("");

  async function run() {
    setRunning(true);
    setErr("");
    setResult(null);
    const list = await fetch("/api/manifest-brands").then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!list) {
      setErr("No se pudo leer la lista de manifiestos.");
      setRunning(false);
      return;
    }
    const acc = { combos: [] as string[], products: [] as string[], conflicts: [] as Conflict[], unread: 0 };
    for (const [i, batchId] of (list.batchIds as string[]).entries()) {
      setProgress(`Revisando subida ${i + 1} de ${list.batchIds.length}…`);
      const r = await fetch("/api/manifest-brands", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batchId }) })
        .then((x) => (x.ok ? x.json() : null))
        .catch(() => null);
      if (!r) {
        acc.unread++;
        continue;
      }
      acc.combos.push(...r.combos);
      acc.products.push(...r.products);
      acc.unread += r.unread;
      for (const c of r.conflicts as Conflict[]) if (!acc.conflicts.some((x) => x.kind === c.kind && x.code === c.code && x.manifest === c.manifest)) acc.conflicts.push(c);
    }
    setProgress("");
    setResult(acc);
    setRunning(false);
    onDone();
  }

  return (
    <div className="border border-rule rounded-md p-3 mb-3 bg-cloud">
      <div className="text-[12.5px] font-bold mb-0.5">Marcas aprendidas de los manifiestos</div>
      <div className="text-[11.5px] text-steel mb-2">
        Cada PDF que sube Yair es el manifiesto de una marca. La app pone esa marca sola a los IDs que vienen en él y no la tenían (sobre todo combos). Nunca cambia una marca que ya está puesta: si no coincide, te la muestra abajo para que decidas.
      </div>
      <button
        type="button"
        disabled={running}
        onClick={run}
        className="flex items-center gap-1.5 rounded border border-teal px-3 py-1.5 text-[12px] font-bold text-teal cursor-pointer disabled:opacity-60"
      >
        <RefreshCw size={13} className={running ? "animate-spin" : ""} /> {running ? progress || "Revisando…" : "Revisar manifiestos ya subidos"}
      </button>
      {err && <div className="text-red text-[12px] mt-2">{err}</div>}
      {result && (
        <div className="text-[12px] mt-2 flex flex-col gap-1">
          <div>
            Listo: {result.combos.length} combo(s) y {result.products.length} producto(s) tomaron su marca
            {result.combos.length > 0 ? ` (combos: ${[...new Set(result.combos)].join(", ")})` : ""}.
            {result.unread > 0 ? ` ${result.unread} archivo(s) no se pudieron abrir.` : ""}
          </div>
          {result.conflicts.length > 0 && (
            <div className="bg-gold/15 border border-gold/40 rounded-md p-2">
              <div className="font-semibold mb-1">No coinciden ({result.conflicts.length}) — la app no los cambió:</div>
              {result.conflicts.map((c) => (
                <div key={`${c.kind}-${c.code}-${c.manifest}`}>
                  {c.kind === "combo" ? "Combo" : "Producto"} <span className="font-mono font-bold">{c.code}</span> {c.name}: marcado {BRAND[c.stored] ?? c.stored}, pero viene en el manifiesto de {BRAND[c.manifest] ?? c.manifest}.
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
