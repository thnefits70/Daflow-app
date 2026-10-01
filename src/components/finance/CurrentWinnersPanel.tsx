import { getCurrentWinners, WINNER_7D_THRESHOLD, WINNER_30D_THRESHOLD } from "@/lib/comboSuggestions";

// Pedido del usuario 2026-09-30: ya no se sube el reporte mensual de
// ganadores — salen solos de los cortes (lo que de verdad salió de bodega),
// sin esperar a que termine el mes. Solo lectura.
export async function CurrentWinnersPanel() {
  const winners = await getCurrentWinners();
  return (
    <div className="bg-surface border border-rule rounded-md p-4">
      <div className="text-[12px] text-steel mb-3">
        Ganador = salió {WINNER_7D_THRESHOLD} o más en los últimos 7 días, o {WINNER_30D_THRESHOLD} o más en los últimos 30 días. Se usan solos para armar Sugerencias de Combos.
      </div>
      {winners.length === 0 ? (
        <div className="border-[1.5px] border-dashed border-rule rounded-md p-5 text-center text-steel text-[12.5px]">Todavía ningún producto llega a esos números.</div>
      ) : (
        <div className="flex flex-col divide-y divide-rule">
          {winners.map((w) => (
            <div key={w.key} className="flex items-center justify-between gap-3 py-1.5 text-[12.5px]">
              <span className="font-semibold min-w-0 truncate">
                {w.name}
                {w.isCombo && <span className="ml-1.5 text-[10px] font-semibold text-teal border border-teal/40 rounded px-1 py-0.5">combo</span>}
              </span>
              <span className="text-steel shrink-0">
                7 días: <b className="text-ink">{w.units7}</b> · 30 días: <b className="text-ink">{w.units30}</b>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
