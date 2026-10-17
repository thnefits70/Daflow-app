import type { ProvedixTraffic } from "@/lib/provedixTraffic";

// Etapa 4 (2026-10-12): cuánta gente entra a provedix.com y qué busca. Sin
// resumen por aviso — el usuario lo revisa aquí; solo los picos le avisan.

function dayShort(iso: string) {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

function Stat({ label, value, sub }: { label: string; value: number; sub: string }) {
  return (
    <div className="bg-surface border border-rule rounded-lg px-4 py-3">
      <div className="font-mono text-[9.5px] font-semibold uppercase tracking-wide text-steel">{label}</div>
      <div className="flex items-baseline gap-2 mt-0.5 min-w-0">
        <div className="font-display text-[22px] font-bold tabular-nums leading-tight">{value.toLocaleString("es-EC")}</div>
        <div className="text-[10.5px] text-steel truncate">{sub}</div>
      </div>
    </div>
  );
}

// Fila de números de arriba: siempre visible, fuera de las pestañas.
export function ProvedixTrafficStats({ traffic }: { traffic: ProvedixTraffic }) {
  const { visitors, leads } = traffic;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
      <Stat label="Personas hoy" value={visitors.today} sub="en la página" />
      <Stat label="Últimos 7 días" value={visitors.last7} sub={`${visitors.last30.toLocaleString("es-EC")} en 30 días`} />
      <Stat label="Registros hoy" value={leads.today} sub={`${leads.last7} en 7 días`} />
      <Stat label="Cartera total" value={leads.total} sub="dropshippers" />
    </div>
  );
}

export function ProvedixTrafficCard({ traffic }: { traffic: ProvedixTraffic }) {
  const { topSearches, topProducts, topWhatsapp } = traffic;
  // Sin los días vacíos del principio (antes de que la página existiera).
  const firstDay = traffic.daily.findIndex((d) => d.visitors > 0 || d.leads > 0);
  const daily = firstDay > 0 ? traffic.daily.slice(firstDay) : traffic.daily;
  const maxDay = Math.max(1, ...daily.map((d) => d.visitors));
  const maxProduct = Math.max(1, ...topProducts.map((p) => p.count));

  return (
    <div>
      <div className="bg-surface border border-rule rounded-lg p-5 mb-5">
        <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
          <div className="text-[13px] font-semibold">Personas por día</div>
          <div className="text-[11px] text-steel">Si de golpe entra mucha más gente de lo normal, te llega un aviso al celular.</div>
        </div>
        <div className="flex items-end gap-1.5 h-[90px]">
          {daily.map((d) => (
            <div key={d.day} className="flex-1 min-w-0 flex flex-col items-center justify-end h-full gap-1" title={`${dayShort(d.day)}: ${d.visitors} personas, ${d.leads} registros`}>
              <div className="text-[9.5px] tabular-nums text-steel">{d.visitors || ""}</div>
              <div className="w-full rounded-t bg-teal" style={{ height: `${(d.visitors / maxDay) * 80}%`, minHeight: d.visitors ? 3 : 0 }} />
            </div>
          ))}
        </div>
        <div className="flex gap-1.5 mt-1 border-t border-rule pt-1">
          {daily.map((d, i) => (
            <div key={d.day} className="flex-1 min-w-0 text-center text-[9px] text-steel tabular-nums">
              {daily.length <= 10 || (daily.length - 1 - i) % 2 === 0 ? dayShort(d.day) : ""}
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="bg-surface border border-rule rounded-lg p-5">
          <div className="text-[13px] font-semibold mb-3">Lo que más buscan · 30 días</div>
          {topSearches.length === 0 && <div className="text-[12px] text-steel">Todavía nadie ha buscado nada.</div>}
          <div className="flex flex-col gap-1.5">
            {topSearches.map((s) => (
              <div key={s.label} className="flex items-center justify-between gap-3 text-[12px] border-b border-rule last:border-0 pb-1.5">
                <span className="truncate">{s.label}</span>
                <span className="tabular-nums text-steel shrink-0">{s.count}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-surface border border-rule rounded-lg p-5">
          <div className="text-[13px] font-semibold mb-3">Productos que más abren · 30 días</div>
          {topProducts.length === 0 && <div className="text-[12px] text-steel">Todavía nadie ha abierto una ficha.</div>}
          <div className="flex flex-col gap-2.5">
            {topProducts.map((p) => (
              <div key={p.code} className="grid grid-cols-[minmax(0,1fr)_56px_28px] items-center gap-2">
                <div className="text-[12px] truncate" title={`${p.name} · ID ${p.code}`}>{p.name}</div>
                <div className="h-2 rounded-full bg-cloud overflow-hidden">
                  <div className="h-full rounded-full bg-teal" style={{ width: `${(p.count / maxProduct) * 100}%` }} />
                </div>
                <div className="text-[12px] text-right tabular-nums">{p.count}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-surface border border-rule rounded-lg p-5">
          <div className="text-[13px] font-semibold mb-1">Consultas por WhatsApp · 30 días</div>
          <div className="text-[11px] text-steel mb-3">Si uno está sin stock y lo piden mucho, conviene recomprarlo.</div>
          {topWhatsapp.length === 0 && <div className="text-[12px] text-steel">Todavía nadie ha escrito al asesor desde la página.</div>}
          <div className="flex flex-col gap-1.5">
            {topWhatsapp.map((p) => (
              <div key={p.code} className="flex items-center justify-between gap-3 text-[12px] border-b border-rule last:border-0 pb-1.5">
                <span className="truncate" title={`${p.name} · ID ${p.code}`}>
                  {p.name}
                </span>
                <span className="tabular-nums text-steel shrink-0">{p.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
