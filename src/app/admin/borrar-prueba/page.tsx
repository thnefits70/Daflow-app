"use client";

import { useState } from "react";

const CONFIRM_PHRASE = "BORRAR DATOS DE PRUEBA";

// Página temporal, un solo uso — limpieza de anticipos, descuentos y
// cuentas bancarias de prueba antes de arrancar con datos reales. Borrar
// este archivo (y la ruta en src/app/api/payroll/reset-test-data/) apenas
// se use.
export default function BorrarPruebaPage() {
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ advances: number; deductions: number; bankAccounts: number } | null>(null);
  const [err, setErr] = useState("");

  async function run() {
    setBusy(true);
    setErr("");
    const res = await fetch("/api/payroll/reset-test-data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm }),
    });
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(data?.error ?? "No se pudo borrar.");
      return;
    }
    setResult(data);
  }

  if (result) {
    return (
      <div className="max-w-md p-6">
        <div className="font-bold text-lg mb-2 text-green">Listo, se borró</div>
        <div className="text-sm">Anticipos: {result.advances}</div>
        <div className="text-sm">Descuentos: {result.deductions}</div>
        <div className="text-sm">Cuentas bancarias: {result.bankAccounts}</div>
      </div>
    );
  }

  return (
    <div className="max-w-md p-6">
      <div className="font-bold text-lg mb-2">Borrar anticipos, descuentos y cuentas bancarias de prueba</div>
      <div className="text-sm text-steel mb-4">
        Esto borra TODOS los anticipos de sueldo, descuentos administrativos y cuentas bancarias de colaborador que existen ahora mismo — son los de prueba (Yair Urgilez, Bryan Ríos, Daniel Morán, Nairoby Castro, Robert Salinas, Marcos Damián, Allan Anastacio, Luis Castillo). Nómina sigue sin ningún rol real corrido, así que no hay datos reales que perder. Escribí la frase exacta para confirmar.
      </div>
      <input
        className="border border-rule rounded px-3 py-2 w-full mb-3 text-sm"
        placeholder={CONFIRM_PHRASE}
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
      />
      {err && <div className="text-red text-sm mb-2">{err}</div>}
      <button
        type="button"
        disabled={confirm !== CONFIRM_PHRASE || busy}
        className="bg-red text-white font-bold rounded px-4 py-2 disabled:opacity-40"
        onClick={run}
      >
        {busy ? "Borrando…" : "Borrar"}
      </button>
    </div>
  );
}
