import type { ProvedixOverview } from "@/lib/provedixAdmin";
import { brandLabel } from "@/lib/brandLabels";
import { StoreSalesTable } from "@/components/provedix/StoreSalesTable";
import { SnapshotPreview } from "@/components/provedix/SnapshotPreview";
import type { ProvedixSnapshotData } from "@/lib/provedixSnapshot";
import type { ProvedixChatRow, ProvedixLeadRow, ProvedixTraffic } from "@/lib/provedixTraffic";
import { ProvedixTrafficCard, ProvedixTrafficStats } from "@/components/provedix/ProvedixTrafficCard";
import { ProvedixLeadsTable } from "@/components/provedix/ProvedixLeadsTable";
import { ProvedixChatsCard } from "@/components/provedix/ProvedixChatsCard";
import { MichelleStatsCard } from "@/components/provedix/MichelleStatsCard";
import { MichelleCasesPanel } from "@/components/provedix/MichelleCasesPanel";
import type { MichelleWeekStat } from "@/lib/provedixCases";
import type { RatingsOverview } from "@/lib/provedixRatings";
import { ProvedixRatingsCard } from "@/components/provedix/ProvedixRatingsCard";
import { TeamPhotosCard } from "@/components/provedix/TeamPhotosCard";
import { MichelleFunnelCard } from "@/components/provedix/MichelleFunnelCard";
import type { MichelleFunnel } from "@/lib/provedixMichelleFunnel";
import type { getTeamPhotosAdmin } from "@/lib/provedixTeamPhotoSync";
import { ProvedixTabs } from "@/components/provedix/ProvedixTabs";

// 2026-10-17 (pedido del usuario): la sección pasó de una columna larga a
// números arriba + pestañas. Se quitaron las 4 etapas (todas listas) y el
// texto de introducción; la lectura de guías solo sale si falta leer algo.

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

function SmallStat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-surface border border-rule rounded-lg px-4 py-3">
      <div className="font-mono text-[9.5px] font-semibold uppercase tracking-wide text-steel">{label}</div>
      <div className="font-display text-[22px] font-bold tabular-nums leading-tight mt-0.5">{value}</div>
      <div className="text-[10.5px] text-steel mt-0.5">{sub}</div>
    </div>
  );
}

export function ProvedixPanel({
  overview,
  snapshot,
  traffic,
  leads,
  chats,
  michelleStats,
  openCases,
  ratings,
  teamPhotos,
  funnel,
}: {
  overview: ProvedixOverview;
  snapshot: (ProvedixSnapshotData & { generatedAt: string }) | null;
  traffic: ProvedixTraffic;
  leads: ProvedixLeadRow[];
  chats: ProvedixChatRow[];
  michelleStats: MichelleWeekStat[];
  openCases: number;
  ratings: RatingsOverview;
  teamPhotos: Awaited<ReturnType<typeof getTeamPhotosAdmin>>;
  funnel: { week: MichelleFunnel; month: MichelleFunnel };
}) {
  const { progress, guides, byBrand, cities, gender, cod, stores, windowFrom } = overview;
  const readPct = pct(progress.read, progress.total);
  const knownGender = gender.F + gender.M;
  const maxCity = Math.max(1, ...cities.map((c) => c.count));

  const sales = (
    <div key="ventas">
      <div className="text-[11px] text-steel mb-3">Desde el {dayLabel(windowFrom)} · solo Provedix e Imp. Damián, sin garantías.</div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        <SmallStat
          label="Pedidos leídos"
          value={guides.toLocaleString("es-EC")}
          sub={byBrand.map((b) => `${brandLabel(b.label)} ${b.count.toLocaleString("es-EC")}`).join(" · ") || "—"}
        />
        <SmallStat
          label="Precio al público más común"
          value={cod.common != null ? money(cod.common) : "—"}
          sub={cod.min != null && cod.max != null ? `de ${money(cod.min)} a ${money(cod.max)} · total ${money(cod.total)}` : "Sin valores todavía"}
        />
        <SmallStat
          label="Compradores"
          value={knownGender > 0 ? `${pct(gender.F, knownGender)}% mujeres` : "—"}
          sub={knownGender > 0 ? `${pct(gender.M, knownGender)}% hombres · aproximado por el nombre` : "Sin datos todavía"}
        />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-surface border border-rule rounded-lg p-5">
          <div className="text-[13px] font-semibold mb-3">Ciudades que más compran</div>
          {cities.length === 0 && <div className="text-[12px] text-steel">Todavía no hay guías leídas.</div>}
          <div className="flex flex-col gap-2.5">
            {cities.map((c) => (
              <div key={c.label} className="grid grid-cols-[minmax(0,140px)_1fr_48px] items-center gap-3">
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
          <div className="text-[11px] text-steel mb-3">Nunca sale en provedix.com. La ven solo tú y Nairoby.</div>
          <StoreSalesTable stores={stores} />
        </div>
      </div>
    </div>
  );

  const page = (
    <div key="pagina">
      {readPct < 100 && (
        <div className="bg-surface border border-rule rounded-lg p-4 mb-5">
          <div className="flex items-baseline justify-between gap-3 flex-wrap mb-2">
            <div className="text-[13px] font-semibold">Lectura de guías guardadas</div>
            <div className="text-[12px] text-steel tabular-nums">
              {progress.read.toLocaleString("es-EC")} de {progress.total.toLocaleString("es-EC")} ({readPct}%)
            </div>
          </div>
          <div className="h-2 rounded-full bg-cloud overflow-hidden">
            <div className="h-full rounded-full bg-teal" style={{ width: `${readPct}%` }} />
          </div>
        </div>
      )}
      <ProvedixRatingsCard data={ratings} />
      <SnapshotPreview snapshot={snapshot} />
      <TeamPhotosCard data={teamPhotos} />
    </div>
  );

  const michelle = (
    <div key="michelle">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
        <MichelleFunnelCard week={funnel.week} month={funnel.month} />
        <MichelleStatsCard stats={michelleStats} openCases={openCases} />
      </div>
      {/* /area/casos-michelle es solo para el equipo: el admin responde los casos aquí. */}
      <div id="casos-michelle" className="bg-surface border border-rule rounded-lg p-5 mb-5 scroll-mt-4">
        <div className="text-[13px] font-semibold mb-3">Casos que Michelle IA pasó al equipo</div>
        <MichelleCasesPanel />
      </div>
      <ProvedixChatsCard chats={chats} />
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div>
          <div className="font-mono text-[10.5px] tracking-[.14em] uppercase text-steel">Provedix</div>
          <h2 className="font-display text-[22px] mt-0.5">Página pública provedix.com</h2>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-rule bg-cloud px-3 py-1 text-[11px] font-semibold text-steel">
          🔒 Solo tú ves esta sección
        </span>
      </div>

      <ProvedixTrafficStats traffic={traffic} />

      <ProvedixTabs
        tabs={[
          { key: "visitas", label: "Visitas", content: <ProvedixTrafficCard key="visitas" traffic={traffic} /> },
          { key: "dropshippers", label: "Dropshippers", content: <ProvedixLeadsTable key="dropshippers" leads={leads} /> },
          { key: "michelle", label: "Michelle IA", badge: openCases, hashes: ["#michelle", "#casos-michelle"], content: michelle },
          { key: "ventas", label: "Ventas", content: sales },
          { key: "pagina", label: "La página", content: page },
        ]}
      />
    </div>
  );
}
