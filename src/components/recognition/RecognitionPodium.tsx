"use client";

import { useEffect, useState } from "react";
import { User } from "lucide-react";

type PodiumEntry = { rank: number; userId: string; name: string; photoUrl: string | null; totalScore: number };

const MEDAL = ["🥇", "🥈", "🥉"];
const MONTH_ABBR = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
function formatMonthShort(month: string) {
  const [y, m] = month.split("-");
  return `${MONTH_ABBR[Number(m) - 1]} ${y.slice(2)}`;
}

// Compact widget for the top-right of Inicio — stays visible with the
// latest confirmed month's top 3 until admin confirms the next one.
// Deliberately small: this is a passive display, not a page of its own.
export function RecognitionPodium() {
  const [data, setData] = useState<{ month: string; podium: PodiumEntry[] } | null>(null);

  useEffect(() => {
    fetch("/api/recognition/podium")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d?.result ?? null))
      .catch(() => {});
  }, []);

  if (!data || data.podium.length === 0) return null;

  // Podium visual order: 2nd, 1st (tallest), 3rd.
  const ordered = [data.podium.find((p) => p.rank === 2), data.podium.find((p) => p.rank === 1), data.podium.find((p) => p.rank === 3)].filter(
    (p): p is PodiumEntry => !!p
  );

  return (
    <div className="bg-surface border border-rule rounded-lg px-4 py-3 shrink-0">
      <div className="text-[9px] font-mono uppercase tracking-wide text-steel mb-2 text-center">
        🏆 Colaborador Destacado · {formatMonthShort(data.month)}
      </div>
      <div className="flex items-end justify-center gap-3">
        {ordered.map((p) => {
          const isFirst = p.rank === 1;
          const size = isFirst ? 42 : 32;
          return (
            <div key={p.userId} className="flex flex-col items-center" style={{ width: 64 }}>
              <div
                className="rounded-full overflow-hidden bg-cloud border-2 flex items-center justify-center shrink-0"
                style={{ width: size, height: size, borderColor: isFirst ? "#D9A441" : "#24365a" }}
              >
                {p.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.photoUrl} alt={p.name} className="w-full h-full object-cover object-top" />
                ) : (
                  <User size={isFirst ? 18 : 14} className="text-steel" />
                )}
              </div>
              <div className="text-[9px] mt-1">{MEDAL[p.rank - 1]}</div>
              <div className="text-[10.5px] font-semibold truncate w-full text-center">{p.name.split(" ")[0]}</div>
              <div className="font-mono text-[9px] text-steel">{p.totalScore}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
