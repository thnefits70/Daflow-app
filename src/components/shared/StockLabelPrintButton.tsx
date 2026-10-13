"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import { Printer } from "lucide-react";

// Pedido de Daniel 2026-10-13: en la recepción de un producto que todavía no
// tiene su etiqueta de percha, apenas llega físicamente, "Imprimir QR" — la
// misma etiqueta de 10x10 cm de Etiquetas de percha (StockLabelsPanel, mismo
// CSS .stock-label-print-root) y queda contada en el mismo registro.
export function StockLabelPrintButton({ catalogItemId, name, code, onPrinted }: { catalogItemId: string; name: string; code: string; onPrinted: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    if (!qr) return;
    // Se imprime cuando la etiqueta ya está en la página; después se quita.
    const done = () => {
      setQr(null);
      onPrinted();
    };
    window.addEventListener("afterprint", done, { once: true });
    const t = setTimeout(() => window.print(), 50);
    return () => {
      clearTimeout(t);
      window.removeEventListener("afterprint", done);
    };
  }, [qr, onPrinted]);

  async function print() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/stock-label-prints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ catalogItemIds: [catalogItemId] }),
      });
      if (!res.ok) throw new Error();
      setConfirming(false);
      setQr(await QRCode.toDataURL(code, { margin: 1, width: 200 }));
    } catch {
      setError("No se pudo guardar. Intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mb-2">
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2 text-[11.5px]">
          <span>Se imprime la etiqueta de percha de este producto y queda contada como impresa.</span>
          <button type="button" disabled={saving} className="rounded border border-blue bg-blue px-3 py-1 text-[11.5px] font-semibold text-white cursor-pointer disabled:opacity-60" onClick={print}>
            {saving ? "Guardando…" : "Sí, imprimir"}
          </button>
          <button type="button" disabled={saving} className="text-steel text-[11.5px] cursor-pointer" onClick={() => { setConfirming(false); setError(""); }}>
            Cancelar
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="flex items-center gap-1.5 text-[11.5px] font-semibold border border-blue/60 text-blue rounded px-3 py-1.5 cursor-pointer"
          onClick={() => setConfirming(true)}
        >
          <Printer size={13} /> Imprimir QR <span className="font-normal text-steel">— aún no tiene etiqueta de percha</span>
        </button>
      )}
      {error && <div className="text-red text-[11px] mt-1">{error}</div>}
      {qr &&
        createPortal(
          <div className="stock-label-print-root">
            <div className="print-stock-label">
              <div className="print-stock-label__name">{name}</div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr} alt={code} className="print-stock-label__qr" />
              <div className="print-stock-label__code">{code}</div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
