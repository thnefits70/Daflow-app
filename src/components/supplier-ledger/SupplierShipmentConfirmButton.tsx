"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";

type Props = {
  token: string;
  requestId: string;
};

// Confirmado 2026-09-17, pedido explícito del usuario: el equipo de
// despacho del proveedor puede apretar este botón, con foto subida o sin
// ella, para marcar "ya lo enviamos" — la fila desaparece de "falta enviar"
// y pasa al historial de solo lectura en el mismo enlace. Puramente
// informativo, no cambia el status real ni reemplaza la recepción de
// Daniel. router.refresh() vuelve a pedir los datos al servidor para que la
// fila se mueva sola, sin recargar toda la página.
export function SupplierShipmentConfirmButton({ token, requestId }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function handleClick() {
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/proveedor-ledger/${token}/requests/${requestId}/confirm-shipped`, { method: "POST" });
    if (!res.ok) {
      setBusy(false);
      setErr("No se pudo confirmar. Intenta de nuevo.");
      return;
    }
    router.refresh();
  }

  return (
    <div>
      <button
        type="button"
        className="flex items-center gap-1.5 text-[12px] font-medium text-emerald-700 border border-emerald-300 bg-emerald-50 rounded-md px-3 py-1.5 cursor-pointer hover:bg-emerald-100 disabled:opacity-60"
        onClick={handleClick}
        disabled={busy}
      >
        <CheckCircle2 size={13} /> {busy ? "Confirmando…" : "Ya lo enviamos"}
      </button>
      {err && <div className="text-[11.5px] text-red-600 mt-1">{err}</div>}
    </div>
  );
}
