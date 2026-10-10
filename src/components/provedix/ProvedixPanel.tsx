import type { ProvedixOverview } from "@/lib/provedixAdmin";
import { brandLabel } from "@/lib/brandLabels";

const STAGES: { title: string; detail: string; done: boolean }[] = [
  { title: "1. Leer las guías", detail: "Ciudad, valor cobrado, hombre/mujer y tienda de cada guía.", done: true },
  { title: "2. Resumen por producto", detail: "Ventas en rangos, precio más común, ciudades y combos reales, con 7 días de retraso.", done: false },
  { title: "3. Página provedix.com", detail: "Catálogo con fotos y registro con nombre y WhatsApp.", done: false },
  { title: "4. Cartera de dropshippers", detail: "Registrados, cuántas veces entran, qué buscan y visitas a la página.", done: false },
];

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

function pct(n: number, total: number) {
  return total > 0 ? Math.round((n / total) * 100) : 0;
}

function dayLabel(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export function ProvedixPanel({ overview }: { overview: ProvedixOverview }) {
  const { progress, guides, byBrand, cities, gender, cod, stores, windowFrom } = overview;
  const readPct = pct(progress.read, progress.total);
  const knownGender = gender.F + gender.M;
  const maxCity = Math.max(1, ...cities.map((c) => c.count));

  return (
    <div>
      <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
        <div>
          <div className="font-mono text-[10.5px] tracking-[.14em] uppercase text-steel">Provedix</div>
          <h2 className="font-display text-[24px] mt-0.5">Página pública provedix.com</h2>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-rule bg-cloud px-3 py-1 text-[11px] font-semibold text-steel">
          🔒 Solo tú ves esta sección
        </span>
      </div>
      <p className="text-[12.5px] text-steel max-w-[640px] mb-6">
        Datos de venta de nuestro inventario (Provedix e Importadora Damián) sacados de las guías de despacho, para que los dropshippers vean qué se
        vende y vendan nuestros productos. Aquí se irá sumando todo lo de la página a medida que se construye.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-7">
        {STAGES.map((s) => (
          <div key={s.title} className={`border rounded-lg p-4 ${s.done ? "bg-surface border-teal/50" : "bg-surface border-rule"}`}>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <div className="text-[12.5px] font-semibold">{s.title}</div>
              <span className={`text-[10px] font-mono font-semibold uppercase rounded-full px-2 py-0.5 ${s.done ? "bg-teal/15 text-teal" : "bg-cloud text-steel"}`}>
                {s.done ? "Listo" : "Pendiente"}
              </span>
            </div>
            <div className="text-[11.5px] text-steel">{s.detail}</div>
          </div>
        ))}
      </div>

      <div className="bg-surface border border-rule rounded-lg p-5 mb-5">
        <div className="flex items-baseline justify-between gap-3 flex-wrap mb-2">
          <div className="text-[13px] font-semibold">Lectura de guías guardadas</div>
          <div className="text-[12px] text-steel tabular-nums">
            {progress.read.toLocaleString("es-EC")} de {progress.total.toLocaleString("es-EC")} guías ({readPct}%)
          </div>
        </div>
        <div className="h-2 rounded-full bg-cloud overflow-hidden">
          <div className="h-full rounded-full bg-teal" style={{ width: `${readPct}%` }} />
        </div>
        <div className="text-[11.5px] text-steel mt-2">
          {readPct >= 100
            ? "Toda la historia está leída. Los cortes nuevos se leen solos al guardarlos."
            : `Los cortes nuevos se leen al guardarlos; los anteriores (desde el ${dayLabel("2026-09-23")}) se van leyendo solos cada día al mediodía.`}
        </div>
      </div>

      <div className="font-mono text-[10.5px] tracking-[.14em] uppercase text-steel mb-2">
        Vista previa · desde el {dayLabel(windowFrom)} · solo Provedix e Imp. Damián, sin garantías
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        <div className="bg-surface border border-rule rounded-lg p-4">
          <div className="font-mono text-[9.5px] font-semibold uppercase tracking-wide text-steel mb-2">Pedidos leídos</div>
          <div className="font-display text-[26px] font-bold tabular-nums">{guides.toLocaleString("es-EC")}</div>
          <div className="text-[10.5px] text-steel mt-1">{byBrand.map((b) => `${brandLabel(b.label)} ${b.count.toLocaleString("es-EC")}`).join(" · ") || "—"}</div>
        </div>
        <div className="bg-surface border border-rule rounded-lg p-4">
          <div className="font-mono text-[9.5px] font-semibold uppercase tracking-wide text-steel mb-2">Precio al público más común</div>
          <div className="font-display text-[26px] font-bold tabular-nums">{cod.common != null ? money(cod.common) : "—"}</div>
          <div className="text-[10.5px] text-steel mt-1">
            {cod.min != null && cod.max != null ? `de ${money(cod.min)} a ${money(cod.max)} · total cobrado ${money(cod.total)}` : "Sin valores todavía"}
          </div>
        </div>
        <div className="bg-surface border border-rule rounded-lg p-4">
          <div className="font-mono text-[9.5px] font-semibold uppercase tracking-wide text-steel mb-2">Compradores</div>
          <div className="font-display text-[26px] font-bold tabular-nums">
            {knownGender > 0 ? `${pct(gender.F, knownGender)}% mujeres` : "—"}
          </div>
          <div className="text-[10.5px] text-steel mt-1">
            {knownGender > 0 ? `${pct(gender.M, knownGender)}% hombres · aproximado por el nombre` : "Sin datos todavía"}
            {gender.unknown > 0 && ` · ${gender.unknown} sin saber`}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
        <div className="bg-surface border border-rule rounded-lg p-5">
          <div className="text-[13px] font-semibold mb-3">Ciudades que más compran</div>
          {cities.length === 0 && <div className="text-[12px] text-steel">Todavía no hay guías leídas.</div>}
          <div className="flex flex-col gap-2.5">
            {cities.map((c) => (
              <div key={c.label} className="grid grid-cols-[minmax(0,140px)_1fr_64px] items-center gap-3">
                <div className="text-[12px] font-medium truncate">{c.label}</div>
                <div className="h-2 rounded-full bg-cloud overflow-hidden">
                  <div className="h-full rounded-full bg-teal" style={{ width: `${(c.count / maxCity) * 100}%` }} />
                </div>
                <div className="text-[12px] text-right tabular-nums">{pct(c.count, guides)}%</div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-surface border border-rule rounded-lg p-5">
          <div className="text-[13px] font-semibold mb-1">Tiendas que más venden nuestros productos</div>
          <div className="text-[11px] text-steel mb-3">Nunca sale en provedix.com. Servientrega y Urbano no traen el celular.</div>
          {stores.length === 0 && <div className="text-[12px] text-steel">Todavía no hay guías leídas.</div>}
          {stores.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-left text-[10.5px] uppercase tracking-wide text-steel">
                    <th className="pb-2 pr-3 font-semibold">Tienda</th>
                    <th className="pb-2 pr-3 font-semibold">Celular</th>
                    <th className="pb-2 font-semibold text-right">Pedidos</th>
                  </tr>
                </thead>
                <tbody>
                  {stores.map((s) => (
                    <tr key={s.name} className="border-t border-rule">
                      <td className="py-2 pr-3">{s.name}</td>
                      <td className="py-2 pr-3 tabular-nums text-steel">{s.phone ?? "—"}</td>
                      <td className="py-2 text-right tabular-nums font-semibold">{s.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
