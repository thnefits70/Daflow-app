"use client";

import { useEffect, useState } from "react";
import type { DropiCheck, DropiFixer } from "@/lib/dropiCatalogCheck";

// Stock y precio en Dropi vs INVESTOCK (pedido del usuario 2026-10-17, ver
// lib/dropiCatalogCheck.ts). Meta del equipo: 1000 pedidos diarios — todo lo
// que tenemos tiene que estar publicado, con stock y con precio que deje margen.
// Corrigen Michelle, Bryan Ríos y Yair (cada ID tiene un responsable; al
// corregirlo en Dropi desaparece para todos). El admin lo ve en solo lectura.

type Row = DropiCheck & { assignee: DropiFixer | null };
type Data = {
  readAt: string;
  errors: string[];
  team: DropiFixer[];
  checks: Row[];
  viewer: { role: "admin" } | { role: "team"; userId: string };
};

const GROUPS: { kind: DropiCheck["kind"]; title: string; help: string; tone: string }[] = [
  {
    kind: "precio_bajo",
    title: "🔴 Precio en Dropi por debajo del mínimo",
    help: "El precio publicado en Dropi está por debajo del Precio Dropi de INVESTOCK (el de Stock Actual): estamos perdiendo margen. Súbelo en Dropi al mínimo o más. Ese mínimo se actualiza solo con las compras y las devoluciones.",
    tone: "border-red/50 bg-red/5",
  },
  {
    kind: "subir_stock",
    title: "🟠 Sube el stock en Dropi: se nos está quedando mercadería",
    help: "Hay mercadería en bodega y Dropi muestra poco o nada. Súbelo para que se venda todo lo que tenemos.",
    tone: "border-amber/50 bg-amber/5",
  },
  {
    kind: "revisar_stock",
    title: "🟡 Se vende y queda poco en bodega",
    help: "Dropi muestra más de lo que hay y le queda menos de una semana al ritmo de venta. No es para frenar la venta: compras ya lo ve para reponer; ajusten Dropi según lleguen las compras.",
    tone: "border-gold/40 bg-gold/5",
  },
];

const money = (n: number | null) => (n == null ? "—" : `$${n.toFixed(2)}`);
const firstName = (n: string) => n.trim().split(/\s+/)[0].charAt(0) + n.trim().split(/\s+/)[0].slice(1).toLowerCase();

function CheckRow({ r, mine }: { r: Row; mine: boolean }) {
  return (
    <div className={`bg-surface border rounded-md p-3 flex flex-wrap items-center gap-3 ${mine ? "border-teal" : "border-rule"}`}>
      <div className="flex-1 min-w-[200px]">
        <div className="font-semibold text-[13px] leading-snug">
          {r.name}
          {r.variant && <span className="text-steel font-normal"> · {r.variant}</span>}
        </div>
        <div className="text-[11.5px] text-steel font-mono">
          ID {r.code} · {r.brand} · {r.sold30} pedido{r.sold30 === 1 ? "" : "s"} en 30 días
          {r.assignee && <span className="font-sans"> · le toca a <b className={mine ? "text-teal" : "text-ink"}>{mine ? "ti" : firstName(r.assignee.name)}</b></span>}
        </div>
      </div>
      {r.kind === "precio_bajo" ? (
        <div className="text-[12.5px] tabular-nums">
          En Dropi <b className="text-red">{money(r.dropiPrice)}</b> · mínimo INVESTOCK <b>{money(r.minPrice)}</b>
        </div>
      ) : (
        <div className="text-[12.5px] tabular-nums">
          Bodega <b>{r.realStock}</b> · Dropi <b className={r.kind === "subir_stock" ? "text-amber" : ""}>{r.dropiStock}</b>
        </div>
      )}
      <a
        href={`https://app.dropi.ec/dashboard/search?search=${r.code}&search_type=semantic`}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded border border-rule px-3 py-1.5 text-[12px] font-semibold hover:border-teal"
      >
        Abrir en Dropi ↗
      </a>
    </div>
  );
}

export function DropiCatalogCheckPanel() {
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function load() {
    fetch("/api/market-products/dropi-catalog-check")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setError("No se pudo leer el catálogo de Dropi. Intenta de nuevo en un momento."));
  }
  useEffect(load, []);

  async function refresh() {
    setBusy(true);
    setError("");
    await fetch("/api/market-products/dropi-catalog-check", { method: "POST" }).catch(() => null);
    load();
    setBusy(false);
  }

  if (!data) return <div className="text-steel text-[13px]">{error || "Leyendo el catálogo de Dropi…"}</div>;
  const me = data.viewer.role === "team" ? data.viewer.userId : null;
  const urgent = data.checks.filter((c) => c.kind !== "revisar_stock");

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-[12px] text-steel">
          Catálogo de Dropi leído el{" "}
          {new Date(data.readAt).toLocaleString("es-EC", { timeZone: "America/Guayaquil", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · se vuelve a leer
          solo cada 2 horas.
          {!me && " Vista de supervisión (solo lectura)."}
        </div>
        {me && (
          <button
            type="button"
            onClick={refresh}
            disabled={busy}
            className="rounded border border-teal bg-teal px-3 py-1.5 text-[12px] font-bold text-navy cursor-pointer disabled:opacity-60"
          >
            {busy ? "Leyendo Dropi…" : "Ya actualicé Dropi · volver a revisar"}
          </button>
        )}
      </div>

      {/* Cuánto le queda a cada uno (precio + stock urgentes). */}
      <div className="mb-5 flex flex-wrap gap-2">
        {data.team.map((t) => {
          const n = urgent.filter((c) => c.assignee?.id === t.id).length;
          return (
            <div key={t.id} className={`rounded-md border px-3 py-2 text-[12.5px] ${n ? "border-red/50 bg-red/5" : "border-teal/50 bg-teal/5"}`}>
              <b>{t.id === me ? "Tú" : firstName(t.name)}</b>: {n ? `${n} por corregir` : "todo corregido ✅"}
            </div>
          );
        })}
      </div>

      {data.errors.length > 0 && <div className="mb-4 rounded-md border border-red/50 bg-red/5 px-3 py-2 text-[12.5px]">No se pudo leer: {data.errors.join(" · ")}</div>}
      {error && <div className="mb-4 text-red text-[12.5px]">{error}</div>}
      {data.checks.length === 0 && <div className="text-[13px] text-steel">Todo en orden: precios y stock en Dropi coinciden con lo que tenemos ✅</div>}
      {GROUPS.map((g) => {
        const rows = data.checks.filter((c) => c.kind === g.kind);
        if (!rows.length) return null;
        const mine = me ? rows.filter((r) => r.assignee?.id === me) : [];
        const others = me ? rows.filter((r) => r.assignee?.id !== me) : rows;
        return (
          <div key={g.kind} className="mb-6">
            <div className="text-[13.5px] font-bold mb-1">
              {g.title} ({rows.length})
            </div>
            <div className={`rounded-md border px-3 py-2 text-[12.5px] mb-3 ${g.tone}`}>{g.help}</div>
            {mine.length > 0 && (
              <>
                <div className="text-[12px] font-bold text-teal mb-1.5">Te tocan a ti ({mine.length})</div>
                <div className="flex flex-col gap-2 mb-3">
                  {mine.map((r) => (
                    <CheckRow key={`${r.kind}-${r.code}-${r.variant ?? ""}`} r={r} mine />
                  ))}
                </div>
              </>
            )}
            {others.length > 0 && (
              <>
                {me && g.kind !== "revisar_stock" && <div className="text-[12px] font-bold text-steel mb-1.5">De tus compañeros: si terminas lo tuyo, ayuda con estos ({others.length})</div>}
                <div className="flex flex-col gap-2">
                  {others.map((r) => (
                    <CheckRow key={`${r.kind}-${r.code}-${r.variant ?? ""}`} r={r} mine={false} />
                  ))}
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
