import type { ProvedixSnapshotData, SnapshotProduct } from "@/lib/provedixSnapshot";
import { brandLabel } from "@/lib/brandLabels";
import { RecalculateSnapshotButton } from "@/components/provedix/RecalculateSnapshotButton";

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

function dayLabel(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

const TREND = { up: "🔥 En subida", down: "Bajando", flat: "Estable" } as const;

function ProductCard({ p }: { p: SnapshotProduct }) {
  const offer = p.offers[0];
  return (
    <div className="bg-surface border border-rule rounded-lg overflow-hidden flex flex-col">
      <div className="relative aspect-square bg-cloud">
        {p.photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.photo} alt={p.name} loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-[11px] text-steel">Sin foto</div>
        )}
        <span className="absolute top-2 left-2 rounded-full bg-black/70 text-white text-[10px] font-mono px-2 py-0.5">#{p.rank}</span>
        {p.trend === "up" && <span className="absolute top-2 right-2 rounded-full bg-orange-500 text-white text-[10px] font-semibold px-2 py-0.5">🔥 En subida</span>}
      </div>
      <div className="p-3 flex flex-col gap-1.5 text-[11.5px]">
        <div className="text-[12.5px] font-semibold leading-snug line-clamp-2">{p.name}</div>
        <div className="text-steel font-mono text-[10.5px]">
          ID {p.code} · {brandLabel(p.brand)}
        </div>
        <div>
          <b>{p.soldRange}</b> vendidos · {p.unitsRange} unid. en 30 días
        </div>
        {offer && (
          <div>
            Se vende a <b>{money(offer.price)}</b>
            {offer.units > 1 ? ` (${offer.units} unid.)` : ""}
            {p.dropiPrice != null && (
              <>
                {" "}· te cuesta {money(p.dropiPrice * offer.units)}
                {p.marginApprox != null && (
                  <>
                    {" "}· margen <b className={p.marginApprox > 0 ? "text-teal" : "text-red"}>~{money(p.marginApprox)}</b>
                  </>
                )}
              </>
            )}
          </div>
        )}
        {p.qtyMix && (
          <div className="text-steel">
            Pedidos: 1 unid. {p.qtyMix.one}% · 2 unid. {p.qtyMix.two}% · 3+ {p.qtyMix.threePlus}%
          </div>
        )}
        {p.cities.length > 0 && (
          <div className="text-steel">📍 {p.cities.slice(0, 3).map((c) => `${c.city} ${c.share}%`).join(" · ")}</div>
        )}
        <div className="text-steel">
          {p.women != null ? `👤 ${p.women}% mujeres` : "👤 sin datos suficientes"}
          {p.deliveryRate != null && ` · ✅ ${p.deliveryRate}% se entrega`}
          {` · ${TREND[p.trend]}`}
        </div>
        {p.combos.length > 0 && (
          <div className="text-steel">
            Combos: {p.combos.map((c) => `${c.name} (ID ${c.code}${c.price != null ? `, ${money(c.price)}` : ""})`).join(" · ")}
          </div>
        )}
      </div>
    </div>
  );
}

export function SnapshotPreview({ snapshot }: { snapshot: (ProvedixSnapshotData & { generatedAt: string }) | null }) {
  return (
    <div className="bg-surface border border-rule rounded-lg p-5 mb-5">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
        <div>
          <div className="text-[13px] font-semibold">Resumen por producto · lo que verá la página</div>
          <div className="text-[11.5px] text-steel mt-0.5">
            {snapshot
              ? `Pedidos del ${dayLabel(snapshot.windowFrom)} al ${dayLabel(snapshot.windowTo)} (7 días de retraso) · ${snapshot.products.length} productos · calculado el ${new Date(snapshot.generatedAt).toLocaleString("es-EC", { timeZone: "America/Guayaquil", dateStyle: "short", timeStyle: "short" })}`
              : "Todavía no se ha calculado. Se calcula solo cada día al mediodía, o pulsa Recalcular ahora."}
          </div>
        </div>
        <RecalculateSnapshotButton />
      </div>
      <div className="text-[11px] text-steel mb-4">
        Solo rangos y porcentajes: ningún dato de clientes ni nombres de tiendas. El margen es antes de flete y publicidad. Ciudades con menos de 3
        pedidos van en &quot;Otras&quot;.
      </div>
      {snapshot && snapshot.products.length > 0 && (
        <details className="group">
          <summary className="list-none [&::-webkit-details-marker]:hidden cursor-pointer select-none inline-flex items-center gap-1.5 rounded-md border border-rule px-3 py-1.5 text-[12px] font-medium hover:bg-cloud">
            <span className="inline-block transition-transform group-open:rotate-90">▸</span>
            <span className="group-open:hidden">Ver productos</span>
            <span className="hidden group-open:inline">Ocultar productos</span>
          </summary>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 mt-4">
            {snapshot.products.slice(0, 40).map((p) => (
              <ProductCard key={p.code} p={p} />
            ))}
          </div>
          {snapshot.products.length > 40 && (
            <div className="text-[11.5px] text-steel mt-3">Se muestran los 40 primeros de {snapshot.products.length}.</div>
          )}
        </details>
      )}
    </div>
  );
}
