"use client";

import { useState } from "react";
import { Camera } from "lucide-react";
import { LiveCameraCapture } from "@/components/shared/LiveCameraCapture";

type Props = {
  token: string;
  requestId: string;
  initialPhotoUrl: string | null;
};

// Confirmado 2026-09-15, pedido explícito del usuario: foto EN VIVO (nunca
// de galería) que el propio CHEN sube desde su enlace público, sin login,
// por cada pedido "APPROVED" que le falta enviar. Enteramente opcional y de
// referencia — nadie de nuestro equipo la revisa ni la confirma después, no
// reemplaza la recepción real que hace Daniel. Una vez subida, se muestra la
// miniatura en vez del botón — no hay forma de cambiarla desde acá porque no
// hace falta (es solo un refuerzo informal, no un documento formal).
export function SupplierShippingPhotoCapture({ token, requestId, initialPhotoUrl }: Props) {
  const [photoUrl, setPhotoUrl] = useState(initialPhotoUrl);
  const [capturing, setCapturing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function handleCaptured(url: string) {
    setSaving(true);
    setErr("");
    const res = await fetch(`/api/proveedor-ledger/${token}/requests/${requestId}/photo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    setSaving(false);
    if (!res.ok) {
      setErr("No se pudo guardar la foto. Intenta de nuevo.");
      return;
    }
    setPhotoUrl(url);
    setCapturing(false);
  }

  if (photoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={photoUrl} alt="Foto enviada" className="w-24 h-24 object-cover rounded-md border border-neutral-200" />
    );
  }

  if (capturing) {
    return (
      <div className="w-full max-w-xs">
        <LiveCameraCapture
          folder="supplier-shipping-photos"
          signUrl={`/api/proveedor-ledger/${token}/upload-sign`}
          onCaptured={handleCaptured}
          onCancel={() => setCapturing(false)}
        />
        {saving && <div className="text-[11.5px] text-neutral-500 mt-1">Guardando…</div>}
        {err && <div className="text-[11.5px] text-red-600 mt-1">{err}</div>}
      </div>
    );
  }

  return (
    <button
      type="button"
      className="flex items-center gap-1.5 text-[12px] font-medium text-neutral-600 border border-neutral-300 rounded-md px-3 py-1.5 cursor-pointer hover:bg-neutral-50"
      onClick={() => setCapturing(true)}
    >
      <Camera size={13} /> Subir foto (opcional)
    </button>
  );
}
