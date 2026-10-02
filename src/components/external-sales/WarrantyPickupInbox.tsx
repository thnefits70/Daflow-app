"use client";

import { useEffect, useState } from "react";
import { PackageCheck } from "lucide-react";
import { anyReasonLabel } from "@/lib/localWarrantyConstants";
import { formatDateTime } from "@/lib/formatDateTime";

type Row = {
  id: string;
  code: string;
  clientName: string | null;
  pickupPersonName: string;
  deliveredAt: string;
  advisor: { name: string };
  items: { id: string; quantity: number; warrantyReason: string | null; declaredProductName: string; pickupReceivedAt: string | null; catalogItem: { name: string; photos: string[]; justCode: string | null } | null }[];
};

// Garantías locales (pedido del usuario 2026-10-02): lo que el motorizado
// recogió donde el cliente (dañado, mandado por error o de más) llega a
// bodega y alguien de Inventario confirma que llegó. No cambia el stock:
// solo deja el registro y habilita al asesor a cerrar la garantía.
export function WarrantyPickupInbox() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  function load() {
    fetch("/api/external-sales/pending-pickups")
      .then((r) => (r.ok ? r.json() : []))
      .then(setRows)
      .catch(() => setRows([]));
  }
  useEffect(load, []);

  async function receive(id: string) {
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/external-sales/${id}/pickup-received`, { method: "POST" });
    const json = await res.json().catch(() => null);
    setBusy(false);
    setConfirming(null);
    if (!res.ok) setErr(json?.error ?? "No se pudo confirmar.");
    load();
  }

  if (rows === null || rows.length === 0) return null;
  return (
    <section className="mb-6">
      <h3 className="font-display text-[15px] font-bold mb-1 flex items-center gap-2">
        <PackageCheck size={15} /> Garantías: lo que trajo el motorizado
      </h3>
      <p className="text-[12px] text-steel mb-2">Confirma que llegó a bodega. No cambia el stock: lo dañado ya se descontó en el despacho original y lo que se mandó por error nunca se descontó.</p>
      {err && <div className="text-red text-[12.5px] mb-2">{err}</div>}
      <div className="flex flex-col gap-2">
        {rows.map((r) => (
          <div key={r.id} className="border border-rule rounded-md p-3 text-[12.5px]">
            <div className="flex flex-wrap gap-x-3">
              <b className="font-mono">{r.code}</b>
              <span>{r.clientName}</span>
              <span className="text-steel">motorizado {r.pickupPersonName} · salió {formatDateTime(r.deliveredAt)} · asesor {r.advisor.name}</span>
            </div>
            <ul className="mt-1 list-disc pl-5">
              {r.items.map((i) => (
                <li key={i.id}>
                  {i.catalogItem?.name ?? i.declaredProductName} ×{i.quantity} <span className="text-steel">({anyReasonLabel(i.warrantyReason)})</span>
                  {i.pickupReceivedAt && <span className="text-teal"> ✓ recibido</span>}
                </li>
              ))}
            </ul>
            {confirming === r.id ? (
              <div className="flex flex-wrap items-center gap-2 mt-2 bg-cloud border border-rule rounded px-2 py-1.5">
                ¿Confirmas que llegó todo esto a bodega?
                <button type="button" disabled={busy} className="rounded border border-gold bg-gold px-2.5 py-1 font-bold text-navy cursor-pointer" onClick={() => receive(r.id)}>
                  {busy ? "Guardando…" : "Sí, llegó"}
                </button>
                <button type="button" className="text-steel cursor-pointer" onClick={() => setConfirming(null)}>Cancelar</button>
              </div>
            ) : (
              <button type="button" className="mt-2 rounded border border-teal bg-teal px-2.5 py-1 font-bold text-navy cursor-pointer" onClick={() => setConfirming(r.id)}>
                Llegó a bodega
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
