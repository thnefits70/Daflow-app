"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, X } from "lucide-react";

type Props = {
  token: string;
  requestId: string;
  // Confirmado 2026-09-24: el mismo botón sirve para "ya enviamos el
  // faltante/cambio" de una reposición (resolutions/[id]/confirm-shipped).
  kind?: "request" | "resolution";
  label?: string;
};

// Confirmado 2026-09-17, pedido explícito del usuario: el equipo de
// despacho del proveedor puede apretar este botón, con foto subida o sin
// ella, para marcar "ya lo enviamos" — la fila desaparece de "falta enviar"
// y pasa al historial de solo lectura en el mismo enlace. Puramente
// informativo, no cambia el status real ni reemplaza la recepción de
// Daniel. router.refresh() vuelve a pedir los datos al servidor para que la
// fila se mueva sola, sin recargar toda la página.
//
// Confirmado 2026-09-17, pedido explícito del usuario: doble confirmación
// antes de mandar el POST — con una fila de botones idénticos uno debajo
// del otro (ver captura real del usuario), un clic accidental en el botón
// equivocado es fácil. El primer clic solo abre un paso intermedio
// ("¿Seguro?") que hay que confirmar aparte.
export function SupplierShipmentConfirmButton({ token, requestId, kind = "request", label = "Ya lo enviamos" }: Props) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function handleConfirm() {
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/proveedor-ledger/${token}/${kind === "resolution" ? "resolutions" : "requests"}/${requestId}/confirm-shipped`, { method: "POST" });
    if (!res.ok) {
      setBusy(false);
      setErr("No se pudo confirmar. Intenta de nuevo.");
      return;
    }
    router.refresh();
  }

  if (confirming) {
    return (
      <div>
        <p className="text-[11.5px] text-neutral-600 mb-1">¿Seguro que ya lo enviaron?</p>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className="flex items-center gap-1.5 text-[12px] font-medium text-white bg-emerald-600 rounded-md px-3 py-1.5 cursor-pointer hover:bg-emerald-700 disabled:opacity-60"
            onClick={handleConfirm}
            disabled={busy}
          >
            <CheckCircle2 size={13} /> {busy ? "Confirmando…" : "Sí, ya lo enviamos"}
          </button>
          <button
            type="button"
            className="flex items-center gap-1 text-[12px] font-medium text-neutral-600 border border-neutral-300 rounded-md px-2.5 py-1.5 cursor-pointer hover:bg-neutral-50 disabled:opacity-60"
            onClick={() => setConfirming(false)}
            disabled={busy}
          >
            <X size={13} /> Cancelar
          </button>
        </div>
        {err && <div className="text-[11.5px] text-red-600 mt-1">{err}</div>}
      </div>
    );
  }

  return (
    <button
      type="button"
      className="flex items-center gap-1.5 text-[12px] font-medium text-emerald-700 border border-emerald-300 bg-emerald-50 rounded-md px-3 py-1.5 cursor-pointer hover:bg-emerald-100"
      onClick={() => setConfirming(true)}
    >
      <CheckCircle2 size={13} /> {label}
    </button>
  );
}
