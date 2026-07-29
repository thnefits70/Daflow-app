import Link from "next/link";

// Confirmado 2026-07-29: chip chiquito, solo para admin — vive en el
// tercer slot (antes vacío) del header de Inicio, junto al podio de
// Colaborador Destacado. Un clic abre el panel completo en /admin/gasto-ia.
export function AiSpendWidget({ today, month }: { today: number; month: number }) {
  return (
    <div className="flex justify-end">
      <Link
        href="/admin/gasto-ia"
        title="Gasto de IA — solo tú lo ves"
        className="inline-flex items-center gap-2 rounded-full border border-rule bg-cloud px-3 py-1.5 text-[11.5px] text-steel hover:border-teal/50 transition-colors"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-teal shrink-0" />
        <span>
          IA hoy <b className="text-ink font-semibold">${today.toFixed(2)}</b>
        </span>
        <span className="text-steel/60">·</span>
        <span>
          mes <b className="text-ink font-semibold">${month.toFixed(2)}</b>
        </span>
        <span className="text-steel/60">→</span>
      </Link>
    </div>
  );
}
