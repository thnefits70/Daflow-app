"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";

type JustGroupDTO = {
  name: string;
  totalGoodQty: number;
  itemIds: string[];
  canUploadNow: boolean;
  breakdown: { id: string; batchCode: string; goodQty: number; createdAt: string }[];
};

function fmt(iso: string) {
  return new Date(iso).toLocaleString("es-EC", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function fmtDay(iso: string) {
  return new Date(iso).toLocaleDateString("es-EC", { weekday: "long", day: "2-digit", month: "short" });
}

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "Ocurrió un error.");
  return data;
}

// Confirmado 2026-08-21: lo dañado ("no solucionado") ya no se cierra acá
// item por item — sigue el ciclo semanal en la pestaña "Control de Daños"
// (ver WeeklyDamageControl.tsx), sin excepción, para evitar el doble
// proceso reingreso+baja.
export function CloseQueues({ canManage }: { canManage: boolean }) {
  const [forJust, setForJust] = useState<JustGroupDTO[]>([]);
  const [justUploadMinQty, setJustUploadMinQty] = useState(10);
  const [nextEligibleDay, setNextEligibleDay] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyName, setBusyName] = useState<string | null>(null);
  const [confirmingName, setConfirmingName] = useState<string | null>(null);
  const [errorName, setErrorName] = useState<string | null>(null);
  const [expandedJust, setExpandedJust] = useState<string | null>(null);

  function load() {
    fetch("/api/merchandise-reentry/batches/close")
      .then((r) => r.json())
      .then((data) => {
        setForJust(data.forJust ?? []);
        setJustUploadMinQty(data.justUploadMinQty ?? 10);
        setNextEligibleDay(data.nextEligibleDay ?? null);
      })
      .catch(() => setForJust([]))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function markJustUploaded(group: JustGroupDTO) {
    setBusyName(group.name);
    setErrorName(null);
    try {
      await postJson("/api/merchandise-reentry/items/bulk-just-uploaded", { itemIds: group.itemIds });
      setConfirmingName(null);
      load();
    } catch (e) {
      setErrorName(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setBusyName(null);
    }
  }

  if (loading) return <div className="text-[13px] text-steel">Cargando…</div>;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <CheckCircle2 size={15} className="text-teal" />
        <span className="text-[13.5px] font-bold">Para ingresar a Just</span>
        <span className="font-mono text-[10px] font-bold text-teal bg-teal/15 border border-teal/40 rounded-full px-2 py-0.5">{forJust.length}</span>
        {!canManage && <span className="font-mono text-[9.5px] text-steel bg-cloud rounded-full px-1.5 py-0.5">solo lectura</span>}
      </div>
      <div className="text-[11px] text-steel mb-3">Ordenado de mayor a menor cantidad. Más de {justUploadMinQty} unidades se sube apenas esté listo; con {justUploadMinQty} o menos, se junta y se sube el último día laboral de la semana.</div>
      <div className="flex flex-col gap-2.5 max-w-xl">
        {forJust.length === 0 && <div className="text-[12px] text-steel border-[1.5px] border-dashed border-rule rounded-md p-5 text-center">Nada pendiente por ahora.</div>}
        {forJust.map((group) => (
          <div key={group.name} className="bg-surface border border-rule rounded-md overflow-hidden">
            <div className="p-3.5">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-[12.5px] flex-1 min-w-0">{group.name}</span>
                {group.breakdown.length > 1 && (
                  <button
                    type="button"
                    title="Ver desglose por lote"
                    className="w-7 h-7 shrink-0 rounded border border-rule flex items-center justify-center cursor-pointer text-steel hover:text-teal"
                    onClick={() => setExpandedJust(expandedJust === group.name ? null : group.name)}
                  >
                    {expandedJust === group.name ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  </button>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-green font-semibold">
                  <span className="font-mono text-teal">{group.breakdown.map((b) => b.batchCode).join(", ")}</span> · {group.totalGoodQty} unidades buenas
                </span>
                {group.canUploadNow ? (
                  confirmingName !== group.name && (
                    <button
                      type="button"
                      disabled={!canManage}
                      title={!canManage ? "Exclusivo de Nairoby o el líder de Inventario" : undefined}
                      className="rounded border border-teal bg-teal px-3 py-1.5 text-[11.5px] font-bold text-navy cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                      onClick={() => {
                        if (!canManage) return;
                        setConfirmingName(group.name);
                        setErrorName(null);
                      }}
                    >
                      ✓ Subido a Just
                    </button>
                  )
                ) : (
                  <span
                    title={`${justUploadMinQty} unidades o menos — se habilita el último día laboral de la semana`}
                    className="font-mono text-[10px] font-semibold text-steel bg-cloud border border-rule rounded-full px-2 py-1 whitespace-nowrap"
                  >
                    Se habilita {nextEligibleDay ? fmtDay(nextEligibleDay) : "el último día laboral"}
                  </span>
                )}
              </div>
              {confirmingName === group.name && (
                <div className="mt-2.5 bg-cloud border border-rule rounded-md p-3">
                  <div className="text-[11.5px] mb-2">
                    ¿Confirmas que ya subiste <b>{group.name}</b> ({group.totalGoodQty} unidades) al sistema Just? Esto marca el producto como cerrado en Reingreso de Mercadería.
                  </div>
                  {errorName && <div className="text-[11px] text-red mb-2">{errorName}</div>}
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      disabled={busyName === group.name}
                      className="rounded border border-teal bg-teal px-3 py-1.5 text-[11.5px] font-bold text-navy cursor-pointer disabled:opacity-60"
                      onClick={() => markJustUploaded(group)}
                    >
                      Sí, confirmar
                    </button>
                    <button
                      type="button"
                      disabled={busyName === group.name}
                      className="rounded border border-rule px-3 py-1.5 text-[11.5px] font-semibold cursor-pointer disabled:opacity-60"
                      onClick={() => {
                        setConfirmingName(null);
                        setErrorName(null);
                      }}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>
            {expandedJust === group.name && (
              <div className="bg-cloud border-t border-rule p-3 flex flex-col gap-1.5">
                {group.breakdown.map((b) => (
                  <div key={b.id} className="flex items-center gap-2 text-[11.5px]">
                    <span className="font-mono font-bold text-teal">{b.batchCode}</span>
                    <span className="text-steel">· {fmt(b.createdAt)}</span>
                    <span className="ml-auto text-green font-semibold">{b.goodQty} buenas</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
