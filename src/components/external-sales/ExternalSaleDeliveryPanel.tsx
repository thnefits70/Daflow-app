"use client";

import { useEffect, useState } from "react";
import { Camera, Check } from "lucide-react";
import { LiveCameraCapture } from "@/components/shared/LiveCameraCapture";
import { CatalogCode } from "@/components/shared/CatalogCode";

type SaleDTO = {
  id: string;
  code: string;
  declaredProductName: string;
  catalogItem: { name: string; photos: string[]; justCode: string | null } | null;
  quantity: number;
  pickupPersonName: string;
  courierNote: string | null;
};

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "Ocurrió un error.");
  return data;
}

// Confirmado 2026-08-25, pedido explícito del usuario: acá NUNCA se
// muestran precios ni valores económicos — solo lo que hace falta para
// despachar bien.
export function ExternalSaleDeliveryPanel() {
  const [sales, setSales] = useState<SaleDTO[] | null>(null);
  const [delivering, setDelivering] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [taking, setTaking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function load() {
    fetch("/api/external-sales/my-deliveries").then((r) => r.json()).then(setSales).catch(() => setSales([]));
  }
  useEffect(load, []);

  async function confirm(id: string) {
    if (!photoUrl) return;
    setSaving(true);
    setError("");
    try {
      await postJson(`/api/external-sales/${id}/deliver`, { photoUrl });
      setDelivering(null);
      setPhotoUrl(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo confirmar la entrega.");
    } finally {
      setSaving(false);
    }
  }

  if (sales === null) return <div className="text-[13px] text-steel">Cargando…</div>;
  if (sales.length === 0) return <div className="text-[13px] text-steel">No tenés despachos asignados pendientes.</div>;

  return (
    <div className="flex flex-col gap-2.5 max-w-lg">
      {sales.map((s) => {
        const photo = s.catalogItem?.photos[0] ?? null;
        return (
          <div key={s.id} className="bg-surface border border-rule rounded-md p-3.5">
            <div className="flex items-center gap-3 mb-2.5">
              {photo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photo} alt={s.catalogItem?.name ?? s.declaredProductName} className="w-14 h-14 object-cover rounded border border-rule shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold flex items-center gap-1.5 min-w-0">
                  {s.catalogItem && <CatalogCode code={s.catalogItem.justCode} />}
                  <span className="truncate">{s.catalogItem?.name ?? s.declaredProductName}</span>
                </div>
                <div className="text-[11.5px] text-steel">{s.quantity} un.</div>
                <div className="text-[11.5px] font-semibold">Entregar a: {s.pickupPersonName}</div>
                {s.courierNote && <div className="text-[10.5px] text-steel">Transportadora: {s.courierNote}</div>}
              </div>
            </div>

            {delivering === s.id ? (
              <div className="bg-cloud rounded-md p-2.5">
                {photoUrl ? (
                  <div className="flex items-center gap-2 mb-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photoUrl} alt="Foto de la entrega" className="w-16 h-16 object-cover rounded border border-rule" />
                    <button type="button" className="text-[11px] text-blue font-semibold cursor-pointer" onClick={() => { setPhotoUrl(null); setTaking(true); }}>Volver a tomar</button>
                  </div>
                ) : taking ? (
                  <LiveCameraCapture folder="external-sale-delivery-photos" onCaptured={(url) => { setPhotoUrl(url); setTaking(false); }} onCancel={() => setTaking(false)} />
                ) : (
                  <button type="button" className="flex items-center gap-1.5 text-[12px] font-bold border-[1.5px] border-rule rounded-md px-3 py-1.5 cursor-pointer mb-2" onClick={() => setTaking(true)}>
                    <Camera size={13} /> Tomar foto de la entrega
                  </button>
                )}
                {error && <div className="text-red text-[11px] mb-1.5">{error}</div>}
                <div className="flex gap-2">
                  <button type="button" className="flex-1 rounded border border-rule px-2.5 py-1.5 text-[11.5px] font-semibold cursor-pointer" onClick={() => { setDelivering(null); setPhotoUrl(null); }}>Cancelar</button>
                  <button type="button" disabled={saving || !photoUrl} className="flex-1 rounded border border-teal bg-teal px-2.5 py-1.5 text-[11.5px] font-bold text-navy cursor-pointer disabled:opacity-40" onClick={() => confirm(s.id)}>
                    {saving ? "Guardando…" : "Confirmar entrega"}
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="flex items-center gap-1.5 text-[11.5px] font-bold border border-teal text-teal rounded px-2.5 py-1.5 cursor-pointer" onClick={() => setDelivering(s.id)}>
                <Check size={13} /> Marcar como entregado
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
