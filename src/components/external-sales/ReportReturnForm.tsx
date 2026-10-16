"use client";

import { useState } from "react";

// Confirmado 2026-09-16, pedido explícito del usuario: si el cliente no
// quiso recibir el pedido (o lo devolvió), SOLO el asesor dueño de la venta
// lo reporta. Pedido de Marcos 2026-10-16: además dice cuánto se le debe al
// motorizado por esta devolución — se le paga desde Caja Chica (Nairoby o
// Jariel) cuando el paquete vuelve a bodega. Se usa en la tarjeta de la
// venta (Declarar) y en la pestaña Devoluciones.
export function ReportReturnForm({
  saleId,
  declaredFreight,
  isContraEntrega,
  onDone,
  startOpen = false,
  buttonLabel = "El cliente no recibió el pedido",
}: {
  saleId: string;
  declaredFreight: number | null;
  isContraEntrega: boolean;
  onDone: () => void;
  startOpen?: boolean;
  buttonLabel?: string;
}) {
  const [reporting, setReporting] = useState(startOpen);
  const [reason, setReason] = useState("");
  const [freight, setFreight] = useState(declaredFreight && declaredFreight > 0 ? declaredFreight.toFixed(2) : "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const freightNum = freight.trim() === "" ? 0 : Number(freight);
  const freightValid = Number.isFinite(freightNum) && freightNum >= 0 && freightNum <= 1000;

  async function submit() {
    setSaving(true);
    setErr("");
    try {
      const res = await fetch(`/api/external-sales/${saleId}/report-return`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim(), returnFreightCost: freightNum > 0 ? freightNum : null }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "No se pudo registrar la devolución.");
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo registrar la devolución.");
    } finally {
      setSaving(false);
    }
  }

  if (!reporting) {
    return (
      <button type="button" className="text-[11.5px] font-bold text-red cursor-pointer mt-1.5" onClick={() => setReporting(true)}>
        {buttonLabel}
      </button>
    );
  }

  return (
    <div className="bg-red/5 border border-red/30 rounded-md p-2.5 mt-1.5">
      <div className="text-[11.5px] font-semibold mb-1.5">¿Qué pasó?</div>
      <textarea
        className="w-full rounded border border-rule bg-surface px-2.5 py-1.5 text-[12px] mb-2"
        rows={2}
        placeholder="Ej: el cliente no quiso recibirlo…"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <div className="text-[11.5px] font-semibold mb-1">¿Cuánto se le debe al motorizado por esta devolución?</div>
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-[12px] text-steel">$</span>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          className="w-28 rounded border border-rule bg-surface px-2.5 py-1.5 text-[12px]"
          placeholder="0.00"
          value={freight}
          onChange={(e) => setFreight(e.target.value)}
        />
      </div>
      <div className="text-[10.5px] text-steel mb-2">
        {isContraEntrega ? "Con recaudo: el motorizado no cobró nada, así que pon lo que se le debe por ir y volver. " : ""}
        Se le paga desde Caja Chica (Nairoby o Jariel) cuando el paquete vuelva a bodega. Déjalo vacío si no se le debe nada.
      </div>
      {err && <div className="text-red text-[11px] mb-1.5">{err}</div>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={saving || reason.trim().length < 3 || !freightValid}
          className="rounded border border-red bg-red px-3 py-1.5 text-[11.5px] font-bold text-white cursor-pointer disabled:opacity-40"
          onClick={submit}
        >
          {saving ? "Registrando…" : "Registrar devolución"}
        </button>
        <button type="button" className="text-steel text-[11.5px] cursor-pointer" onClick={() => setReporting(false)}>Cancelar</button>
      </div>
    </div>
  );
}
