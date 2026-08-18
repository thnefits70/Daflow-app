"use client";

import { useEffect, useRef, useState } from "react";
import { PackageCheck } from "lucide-react";

type JustaItem = {
  kind: "receipt" | "replacement";
  id: string;
  productName: string;
  supplierName: string;
  quantity: number;
  approvedAt: string | null;
};

function groupByDay(items: JustaItem[]) {
  const map = new Map<string, JustaItem[]>();
  for (const it of items) {
    const day = it.approvedAt ? new Date(it.approvedAt).toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" }) : "Sin fecha";
    if (!map.has(day)) map.set(day, []);
    map.get(day)!.push(it);
  }
  return [...map.entries()];
}

// Confirmado 2026-08-18: pedido explícito del usuario — checklist personal
// de Daniel para pasar al sistema Just (aparte) todo lo que ya aprobó.
// Nunca del equipo (mismo criterio que el resto de aprobaciones de este
// módulo) — ver canActOnPurchaseReceiving en guards.ts.
function itemKey(item: JustaItem) {
  return `${item.kind}-${item.id}`;
}

// Confirmado 2026-08-18: pedido explícito del usuario — evitar que un toque
// sin querer marque algo como subido y desaparezca de la lista. Un click de
// verdad (`dblclick`) es poco confiable en celular (choca con el doble-tap
// para hacer zoom del navegador), así que en su lugar el primer toque arma
// el botón ("¿Confirmar?") y solo el segundo, dentro de 3 segundos, ejecuta
// la acción — mismo resultado, funciona igual de bien con mouse y con dedo.
const CONFIRM_WINDOW_MS = 3000;

export function PurchaseJustaPanel() {
  const [items, setItems] = useState<JustaItem[] | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [confirmingKey, setConfirmingKey] = useState<string | null>(null);
  const confirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [err, setErr] = useState("");

  function load() {
    fetch("/api/purchase-requests/justa-pending").then((r) => (r.ok ? r.json() : [])).then(setItems).catch(() => setItems([]));
  }
  useEffect(load, []);
  useEffect(() => () => { if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current); }, []);

  function handleClick(item: JustaItem) {
    const key = itemKey(item);
    if (confirmingKey === key) {
      if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
      setConfirmingKey(null);
      markUploaded(item);
      return;
    }
    setConfirmingKey(key);
    if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
    confirmTimeoutRef.current = setTimeout(() => setConfirmingKey(null), CONFIRM_WINDOW_MS);
  }

  async function markUploaded(item: JustaItem) {
    const key = itemKey(item);
    setBusyKey(key);
    setErr("");
    const url = item.kind === "receipt"
      ? `/api/purchase-requests/${item.id}/mark-justa-uploaded`
      : `/api/purchase-requests/urgent-resolutions/${item.id}/mark-justa-uploaded`;
    const res = await fetch(url, { method: "POST" });
    setBusyKey(null);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setErr(data?.error ?? "No se pudo marcar como subida.");
      return;
    }
    setItems((its) => (its ?? []).filter((i) => itemKey(i) !== key));
  }

  if (!items) return <div className="text-steel text-[13px]">Cargando…</div>;

  if (items.length === 0) {
    return <div className="border-[1.5px] border-dashed border-rule rounded-md p-8 text-center text-steel text-[13.5px]">No hay nada pendiente de subir a Just.</div>;
  }

  const groups = groupByDay(items);

  return (
    <div className="flex flex-col gap-2.5">
      {err && <div className="text-red text-[12px]">{err}</div>}
      {groups.map(([day, dayItems]) => (
        <div key={day} className="bg-surface border border-rule rounded-md p-4">
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-steel mb-2.5">
            <PackageCheck size={14} /> {day} — {dayItems.length} pendiente{dayItems.length !== 1 ? "s" : ""}
          </div>
          <div className="flex flex-col gap-2">
            {dayItems.map((it) => (
              <div key={`${it.kind}-${it.id}`} className="flex items-center justify-between gap-3 bg-cloud rounded-md px-3 py-2.5">
                <div>
                  <div className="text-[13px] font-semibold">
                    {it.productName} {it.kind === "replacement" && <span className="text-[10px] font-bold uppercase text-teal ml-1">Cambio</span>}
                  </div>
                  <div className="text-[11px] text-steel">{it.supplierName} — {it.quantity} un.</div>
                </div>
                <button
                  type="button"
                  disabled={busyKey === itemKey(it)}
                  className={`rounded border px-3 py-1.5 text-[12px] font-bold text-navy cursor-pointer disabled:opacity-60 shrink-0 ${
                    confirmingKey === itemKey(it) ? "border-gold bg-gold" : "border-teal bg-teal"
                  }`}
                  onClick={() => handleClick(it)}
                >
                  {confirmingKey === itemKey(it) ? "¿Confirmar?" : "✓ Subido a JUST"}
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
