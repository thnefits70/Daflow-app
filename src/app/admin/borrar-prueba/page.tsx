"use client";

import { useState } from "react";

// Página de un solo uso: borra el proveedor/producto de prueba
// ZZDBG_SUPPDEBT_1788962455076_CHEN. Se elimina en cuanto se confirme que
// funcionó — ver src/app/api/admin/borrar-prueba/route.ts.
export default function BorrarPruebaPage() {
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/borrar-prueba", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al borrar.");
      setResult(data.note || JSON.stringify(data.deleted));
    } catch (e) {
      setResult("Error: " + (e instanceof Error ? e.message : "desconocido"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-lg">
      <h1 className="font-display text-xl font-bold text-ink mb-2">Borrar datos de prueba</h1>
      <p className="text-steel text-sm mb-4">
        Borra el proveedor y producto de prueba con el marcador ZZDBG_SUPPDEBT_1788962455076 (CHEN).
      </p>
      <button
        onClick={run}
        disabled={loading}
        className="bg-red text-white font-semibold text-sm px-4 py-2 rounded-md disabled:opacity-50"
      >
        {loading ? "Borrando..." : "Borrar datos de prueba"}
      </button>
      {result && <div className="mt-4 text-sm text-ink bg-cloud border border-rule rounded-md p-3">{result}</div>}
    </div>
  );
}
