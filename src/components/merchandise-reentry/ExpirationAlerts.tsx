"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Clock } from "lucide-react";
import { CatalogCode } from "@/components/shared/CatalogCode";
import { formatCalendarDate } from "@/lib/formatDateTime";

type AlertLot = {
  id: string;
  expirationDate: string;
  quantityRemaining: number;
  catalogItem: { id: string; name: string; justCode: string | null };
};

// Días enteros entre hoy y la fecha de vencimiento (fecha de calendario,
// guardada a medianoche UTC — ver formatCalendarDate).
function daysUntil(dateIso: string): number {
  const d = new Date(dateIso);
  const target = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 86_400_000);
}

// Confirmado 2026-09-23, pedido de Daniel: alerta visible de lotes ya
// vencidos y de los que vencen en 6 meses o menos, arriba de "Lotes de
// caducidad". Tocar un producto lo abre para revisar/borrar su lote.
export function ExpirationAlerts({ onSelect }: { onSelect: (catalogItemId: string) => void }) {
  const [lots, setLots] = useState<AlertLot[] | null>(null);

  useEffect(() => {
    fetch("/api/purchase-catalog/expiration-alerts")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setLots(Array.isArray(d) ? d : []))
      .catch(() => setLots([]));
  }, []);

  if (!lots || lots.length === 0) return null;

  const expired = lots.filter((l) => daysUntil(l.expirationDate) < 0);
  const soon = lots.filter((l) => daysUntil(l.expirationDate) >= 0);

  const row = (l: AlertLot, isExpired: boolean) => {
    const days = daysUntil(l.expirationDate);
    return (
      <button
        key={l.id}
        type="button"
        className="w-full text-left flex items-center gap-2 text-[12px] px-2 py-1.5 rounded hover:bg-cloud cursor-pointer"
        onClick={() => onSelect(l.catalogItem.id)}
      >
        <CatalogCode code={l.catalogItem.justCode} />
        <span className="flex-1 min-w-0 truncate">{l.catalogItem.name}</span>
        <span className="text-steel shrink-0">{l.quantityRemaining} un.</span>
        <span className={`shrink-0 font-semibold ${isExpired ? "text-red" : "text-gold"}`}>
          {isExpired ? `venció ${formatCalendarDate(l.expirationDate)}` : `${formatCalendarDate(l.expirationDate)} · ${days === 0 ? "vence hoy" : `faltan ${days} días`}`}
        </span>
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-2 mb-3">
      {expired.length > 0 && (
        <div className="border border-red/40 rounded-md p-2">
          <div className="flex items-center gap-1.5 text-red text-[12.5px] font-bold mb-1 px-1">
            <AlertTriangle size={13} /> Ya vencidos · {expired.length}
          </div>
          {expired.map((l) => row(l, true))}
        </div>
      )}
      {soon.length > 0 && (
        <div className="border border-gold/40 rounded-md p-2">
          <div className="flex items-center gap-1.5 text-gold text-[12.5px] font-bold mb-1 px-1">
            <Clock size={13} /> Vencen en 6 meses o menos · {soon.length}
          </div>
          {soon.map((l) => row(l, false))}
        </div>
      )}
    </div>
  );
}
