"use client";

import { useState } from "react";

// TEMPORAL — página de un solo uso para aplicar la migración pendiente
// (ver /api/admin/run-client-model-migration). Borrar junto con esa ruta
// una vez confirmado que corrió bien.
export default function RunClientModelMigrationPage() {
  const [result, setResult] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setRunning(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/admin/run-client-model-migration", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Error desconocido.");
      setResult(JSON.stringify(data, null, 2));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="max-w-lg">
      <div className="font-display font-bold text-[16px] mb-3">Aplicar migración pendiente</div>
      <p className="text-[13px] text-steel mb-4">
        Crea la tabla de clientes y la vincula a Ventas Externas. Es seguro darle click más de una vez — si ya se aplicó, no hace nada.
      </p>
      <button type="button" disabled={running} className="rounded border border-teal bg-teal px-4 py-2 text-[13px] font-bold text-navy cursor-pointer disabled:opacity-50" onClick={run}>
        {running ? "Aplicando…" : "Aplicar migración"}
      </button>
      {result && <pre className="mt-3 text-[12px] bg-cloud rounded p-3 whitespace-pre-wrap">{result}</pre>}
      {error && <div className="mt-3 text-[12.5px] text-red">{error}</div>}
    </div>
  );
}
