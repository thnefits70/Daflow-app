"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Clock, HelpCircle } from "lucide-react";
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
// Sin onSelect = solo lectura (Bryan, desde Stock Actual).
export function ExpirationAlerts({ onSelect }: { onSelect?: (catalogItemId: string) => void }) {
  const [lots, setLots] = useState<AlertLot[] | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    fetch("/api/purchase-catalog/expiration-alerts")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setLots(Array.isArray(d) ? d : []))
      .catch(() => setLots([]));
  }, []);

  if (!lots || lots.length === 0) return null;

  const expired = lots.filter((l) => daysUntil(l.expirationDate) < 0);
  const soon = lots.filter((l) => daysUntil(l.expirationDate) >= 0);

  const Row = onSelect ? "button" : "div";
  const row = (l: AlertLot, isExpired: boolean) => {
    const days = daysUntil(l.expirationDate);
    return (
      <Row
        key={l.id}
        type={onSelect ? "button" : undefined}
        className={`w-full text-left flex items-center gap-2 text-[12px] px-2 py-1.5 rounded ${onSelect ? "hover:bg-cloud cursor-pointer" : ""}`}
        onClick={onSelect ? () => onSelect(l.catalogItem.id) : undefined}
      >
        <CatalogCode code={l.catalogItem.justCode} />
        <span className="flex-1 min-w-0 truncate" title={l.catalogItem.name}>{l.catalogItem.name}</span>
        <span className="text-steel shrink-0">{l.quantityRemaining} un.</span>
        <span className={`shrink-0 font-semibold ${isExpired ? "text-red" : "text-gold"}`}>
          {isExpired ? `venció ${formatCalendarDate(l.expirationDate)}` : `${formatCalendarDate(l.expirationDate)} · ${days === 0 ? "vence hoy" : `faltan ${days} días`}`}
        </span>
      </Row>
    );
  };

  return (
    <div className="flex flex-col gap-2 mb-3">
      {/* Confirmado 2026-09-23, pedido del usuario: una explicación corta a
          un clic para quien no sepa qué significa este bloque. */}
      <div>
        <button type="button" className="flex items-center gap-1 text-[11.5px] text-blue cursor-pointer" onClick={() => setShowHelp((v) => !v)}>
          <HelpCircle size={13} /> {showHelp ? "Ocultar explicación" : "¿Qué significa esto?"}
        </button>
        {showHelp && (
          <div className="mt-1.5 rounded-md border border-rule bg-cloud px-3 py-2 text-[12px] text-steel leading-relaxed space-y-1">
            <p>Aquí aparecen los productos que tienen <b className="text-ink">fecha de caducidad</b> y todavía tienen unidades en bodega. Cada fila es un lote: su código, el nombre, cuántas unidades quedan y cuándo vence.</p>
            <p><b className="text-red">Ya vencidos:</b> la fecha ya pasó. Esas unidades <b className="text-ink">no se deben despachar</b>: hay que revisarlas en bodega y decidir qué hacer con ellas (darlas de baja por Registro de Egresos o gestionarlas con el proveedor).</p>
            <p><b className="text-gold">Vencen en 6 meses o menos:</b> todavía se pueden vender, pero hay que <b className="text-ink">darles salida pronto</b> (promocionarlos, meterlos en combos o avisar a ventas) antes de que venzan.</p>
            <p>{onSelect ? "Toca un producto para abrir sus lotes aquí abajo y revisar o corregir la fecha o la cantidad." : "Aquí es solo para consultar. Los lotes se revisan y corrigen en “Lotes de caducidad” (Inventario — Daniel)."}</p>
          </div>
        )}
      </div>
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
