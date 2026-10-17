"use client";

import { useEffect, type ReactNode } from "react";
import { useRememberedState } from "@/lib/rememberedState";

// Pestañas de /admin/provedix (2026-10-17, pedido del usuario: la sección
// era una sola columna larga). Los avisos que llegan con #michelle o
// #casos-michelle abren directo la pestaña de Michelle IA.
export type ProvedixTab = { key: string; label: string; badge?: number; hashes?: string[]; content: ReactNode };

export function ProvedixTabs({ tabs }: { tabs: ProvedixTab[] }) {
  const [active, setActive] = useRememberedState("provedix-tab", tabs[0]?.key);

  useEffect(() => {
    const hash = window.location.hash;
    const target = tabs.find((t) => t.hashes?.includes(hash));
    if (!target) return;
    const t = setTimeout(() => {
      setActive(target.key);
      setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    }, 0);
    return () => clearTimeout(t);
    // Solo al abrir la pantalla.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = tabs.find((t) => t.key === active) ?? tabs[0];
  return (
    <div>
      <div className="flex items-center gap-1 border-b border-rule mb-5 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`px-4 py-2.5 text-[13px] font-semibold cursor-pointer border-b-2 -mb-px whitespace-nowrap inline-flex items-center gap-1.5 ${
              current?.key === t.key ? "border-teal text-ink" : "border-transparent text-steel hover:text-ink"
            }`}
            onClick={() => setActive(t.key)}
          >
            {t.label}
            {!!t.badge && (
              <span className="rounded-full bg-gold/15 text-gold text-[10.5px] font-bold px-1.5 py-px tabular-nums">{t.badge}</span>
            )}
          </button>
        ))}
      </div>
      {current?.content}
    </div>
  );
}
