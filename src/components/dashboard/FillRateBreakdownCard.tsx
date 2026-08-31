"use client";

// Confirmado 2026-07-28 (bug real en producción): formatWeekShort vive en
// WeeklyTrendChart.tsx ("use client") — llamarlo desde un componente de
// servidor tumba la página entera con "Attempted to call X() from the
// server but X is on the client". Este archivo tiene que ser client
// component para poder usarlo, aunque no tenga estado propio.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatWeekShort } from "./WeeklyTrendChart";
import { formatDateTime } from "@/lib/formatDateTime";
import type { FillRateBreakdown } from "@/lib/dashboard";

// Confirmado 2026-08-31: reemplaza las bandas anteriores (≥98/95-97/<95) —
// ≥96% excelente, 90-95% muy bueno, <90% alerta/ineficiente. Debe quedar
// igual que el status/color de dashboard.ts y WeeklyMetricPanel.tsx.
const STATUS_META: Record<NonNullable<FillRateBreakdown>["status"], { label: string; color: string }> = {
  good: { label: "Excelente", color: "#22C55E" },
  regular: { label: "Muy bueno", color: "#D9A441" },
  crit: { label: "Alerta", color: "#E0574A" },
};

function pct(n: number, total: number) {
  return total === 0 ? 0 : Math.round((n / total) * 1000) / 10;
}

// Confirmado 2026-08-31: por debajo de 95% el líder de Fulfillment le debe
// una explicación al equipo — se guarda en el mismo registro semanal y se
// muestra aquí, visible para todos (no un mensaje privado al admin). El
// textarea lo redacta dirigiéndose al equipo a propósito: el compromiso es
// con ellos, no con el admin.
function JustificationSection({
  status,
  data,
  canJustify,
}: {
  status: { label: string; color: string };
  data: NonNullable<FillRateBreakdown>;
  canJustify: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  if (data.justification) {
    return (
      <div className="rounded-md border border-rule bg-cloud px-3.5 py-3 mt-1">
        <div className="text-[11px] font-semibold text-steel mb-1">
          {data.justificationBy ?? "Líder de Fulfillment"} le explica al equipo:
        </div>
        <div className="text-[13px] leading-snug whitespace-pre-wrap">{data.justification}</div>
        {data.justificationAt && (
          <div className="text-[10.5px] text-steel mt-1.5">{formatDateTime(data.justificationAt)}</div>
        )}
      </div>
    );
  }

  if (!canJustify) {
    return (
      <div className="rounded-md border border-dashed border-rule px-3.5 py-3 mt-1 text-[12.5px] text-steel">
        El Fill Rate quedó por debajo de lo normal esta semana — el líder de Fulfillment todavía le debe una
        explicación al equipo. Va a aparecer aquí en cuanto la escriba.
      </div>
    );
  }

  const submit = async () => {
    if (text.trim().length < 10) {
      setErr("Escribe una explicación un poco más completa.");
      return;
    }
    setErr("");
    setBusy(true);
    const res = await fetch(`/api/weekly-metrics/${data.id}/justification`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ justification: text.trim() }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setErr(body?.error ?? "No se pudo guardar.");
      return;
    }
    router.refresh();
  };

  return (
    <div className="rounded-md border px-3.5 py-3 mt-1" style={{ borderColor: status.color, background: `${status.color}14` }}>
      <div className="text-[12.5px] font-semibold mb-1.5">
        El Fill Rate quedó en {status.label.toLowerCase()} esta semana — explícale al equipo qué pasó y qué van a
        hacer para mejorarlo. Todos van a leer esto, así que dirígete a ellos, no al admin.
      </div>
      <textarea
        className="w-full rounded border border-rule px-2.5 py-2 text-[13px] min-h-[80px]"
        placeholder="Ej. Esta semana nos faltó stock en varios SKUs de alta rotación, ya lo estamos coordinando con Compras…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={busy}
      />
      {err && <div className="text-red text-[12px] mt-1.5">{err}</div>}
      <button
        type="button"
        disabled={busy}
        className="mt-2 rounded border border-blue bg-blue px-3.5 py-1.5 text-[12.5px] font-semibold text-white cursor-pointer disabled:opacity-60"
        onClick={submit}
      >
        Publicar para el equipo
      </button>
    </div>
  );
}

// Confirmado 2026-07-28 (boceto aprobado): desglose de la ÚLTIMA semana con
// datos, en 4 etapas — complementa, no reemplaza, la tarjetita chiquita de
// tendencia que ya existe arriba. Va posicionada arriba de Ruptura de Stock
// tanto en Dashboard (admin) como en EmployeeHome (líder de Fulfillment).
export function FillRateBreakdownCard({
  data,
  canJustify = false,
}: {
  data: NonNullable<FillRateBreakdown>;
  canJustify?: boolean;
}) {
  const status = STATUS_META[data.status];
  const segs = [
    {
      label: "Despachadas",
      value: data.dispatched,
      color: "#14C7C7",
      desc: "Se preparó, se etiquetó y se entregó al courier — el proceso completo.",
    },
    {
      label: "Preparadas",
      value: data.prepared,
      color: "#1E5EFF",
      desc: "Empacada y etiquetada, pero no se entregó al courier ese día.",
    },
    {
      label: "Generadas",
      value: data.generated,
      color: "#D9A441",
      desc: "Ya existe la guía/etiqueta, pero el producto no se empacó.",
    },
    {
      label: "Falta de stock",
      value: data.outOfStock,
      color: "#E0574A",
      desc: "No se pudo ni preparar porque no había la mercadería disponible.",
    },
  ];

  return (
    <div className="bg-surface border border-rule rounded-lg p-6 mb-5">
      <div className="flex items-end justify-between flex-wrap gap-2 mb-4">
        <div>
          <div className="font-mono text-[10.5px] uppercase tracking-wide text-steel mb-1">
            Fill Rate · {data.deptName} · {formatWeekShort(data.week)} · última semana
          </div>
          <div className="font-display text-[34px] font-bold leading-none">{data.fillRatePct}%</div>
        </div>
        <span
          className="font-mono text-[11px] font-bold tracking-wide px-3 py-1 rounded-full"
          style={{ color: status.color, border: `1px solid ${status.color}`, background: `${status.color}22` }}
        >
          {status.label}
        </span>
      </div>

      <div className="flex h-8 rounded-md overflow-hidden mb-3.5">
        {segs.map((s) => {
          const w = pct(s.value, data.total);
          return (
            <div
              key={s.label}
              style={{ width: `${w}%`, background: s.color }}
              className="flex items-center justify-center text-[11px] font-bold text-navy"
            >
              {w > 8 ? `${Math.round(w)}%` : ""}
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-4">
        {segs.map((s) => (
          <div key={s.label} className="bg-cloud border border-rule rounded-md px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-[11px] text-steel mb-0.5">
              <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: s.color }} />
              {s.label}
            </div>
            <div className="font-display text-[18px] font-bold">
              {s.value.toLocaleString("es-MX")}
              <span className="text-[11px] text-steel font-normal ml-1">{pct(s.value, data.total)}%</span>
            </div>
            <div className="text-[10.5px] text-steel mt-1 leading-snug">{s.desc}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 text-[11px] text-steel mb-4">
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: "#22C55E" }} />≥96% Excelente</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: "#D9A441" }} />90–95% Muy bueno</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: "#E0574A" }} />&lt;90% Alerta / ineficiente</span>
      </div>

      {data.needsJustification && <JustificationSection status={status} data={data} canJustify={canJustify} />}
    </div>
  );
}
