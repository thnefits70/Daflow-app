"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, PackageMinus } from "lucide-react";

type JustGroupDTO = {
  name: string;
  totalGoodQty: number;
  itemIds: string[];
  breakdown: { id: string; batchCode: string; goodQty: number; createdAt: string }[];
};

type WriteOffGroupDTO = {
  name: string;
  totalDamagedQty: number;
  damageReasonLabel: string | null;
  photoUrl: string | null;
  itemIds: string[];
  breakdown: { id: string; batchCode: string; damagedQty: number; createdAt: string }[];
};

function fmt(iso: string) {
  return new Date(iso).toLocaleString("es-EC", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function CloseQueues() {
  const [forJust, setForJust] = useState<JustGroupDTO[]>([]);
  const [forWriteOff, setForWriteOff] = useState<WriteOffGroupDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyName, setBusyName] = useState<string | null>(null);
  const [expandedJust, setExpandedJust] = useState<string | null>(null);
  const [expandedWriteOff, setExpandedWriteOff] = useState<string | null>(null);

  function load() {
    fetch("/api/merchandise-reentry/batches/close")
      .then((r) => r.json())
      .then((data) => {
        setForJust(data.forJust ?? []);
        setForWriteOff(data.forWriteOff ?? []);
      })
      .catch(() => {
        setForJust([]);
        setForWriteOff([]);
      })
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function markJustUploaded(group: JustGroupDTO) {
    setBusyName(group.name);
    await fetch("/api/merchandise-reentry/items/bulk-just-uploaded", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemIds: group.itemIds }),
    }).catch(() => null);
    setBusyName(null);
    load();
  }

  async function markWriteOff(group: WriteOffGroupDTO) {
    setBusyName(group.name);
    await fetch("/api/merchandise-reentry/items/bulk-write-off", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemIds: group.itemIds }),
    }).catch(() => null);
    setBusyName(null);
    load();
  }

  if (loading) return <div className="text-[13px] text-steel">Cargando…</div>;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div>
        <div className="flex items-center gap-2 mb-3">
          <CheckCircle2 size={15} className="text-teal" />
          <span className="text-[13.5px] font-bold">Para ingresar a Just</span>
          <span className="font-mono text-[10px] font-bold text-teal bg-teal/15 border border-teal/40 rounded-full px-2 py-0.5">{forJust.length}</span>
        </div>
        <div className="flex flex-col gap-2.5">
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
                  <span className="text-[12px] text-green font-semibold">{group.totalGoodQty} unidades buenas{group.breakdown.length > 1 ? ` · ${group.breakdown.length} lotes` : ""}</span>
                  <button
                    type="button"
                    disabled={busyName === group.name}
                    className="rounded border border-teal bg-teal px-3 py-1.5 text-[11.5px] font-bold text-navy cursor-pointer disabled:opacity-60"
                    onClick={() => markJustUploaded(group)}
                  >
                    ✓ Subido a Just
                  </button>
                </div>
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

      <div>
        <div className="flex items-center gap-2 mb-3">
          <PackageMinus size={15} className="text-red" />
          <span className="text-[13.5px] font-bold">Para dar de baja</span>
          <span className="font-mono text-[10px] font-bold text-red bg-red/15 border border-red/40 rounded-full px-2 py-0.5">{forWriteOff.length}</span>
        </div>
        <div className="flex flex-col gap-2.5">
          {forWriteOff.length === 0 && <div className="text-[12px] text-steel border-[1.5px] border-dashed border-rule rounded-md p-5 text-center">Nada más pendiente de baja por ahora.</div>}
          {forWriteOff.map((group) => (
            <div key={group.name} className="bg-surface border border-rule rounded-md overflow-hidden">
              <div className="p-3.5">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-[12.5px] flex-1 min-w-0">{group.name}</span>
                  {group.breakdown.length > 1 && (
                    <button
                      type="button"
                      title="Ver desglose por lote"
                      className="w-7 h-7 shrink-0 rounded border border-rule flex items-center justify-center cursor-pointer text-steel hover:text-teal"
                      onClick={() => setExpandedWriteOff(expandedWriteOff === group.name ? null : group.name)}
                    >
                      {expandedWriteOff === group.name ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="text-[12px] text-red font-semibold">{group.totalDamagedQty} unidades dañadas{group.breakdown.length > 1 ? ` · ${group.breakdown.length} lotes` : ""}</span>
                  {group.damageReasonLabel && <span className="font-mono text-[9.5px] text-steel bg-cloud rounded-full px-1.5 py-0.5">{group.damageReasonLabel}</span>}
                </div>
                <div className="flex items-center justify-between">
                  {group.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={group.photoUrl} alt={group.name} className="w-8 h-8 object-cover rounded border border-rule" />
                  ) : (
                    <span />
                  )}
                  <button
                    type="button"
                    disabled={busyName === group.name}
                    className="rounded border border-red bg-red px-3 py-1.5 text-[11.5px] font-bold text-white cursor-pointer disabled:opacity-60"
                    onClick={() => markWriteOff(group)}
                  >
                    Registrar baja
                  </button>
                </div>
              </div>
              {expandedWriteOff === group.name && (
                <div className="bg-cloud border-t border-rule p-3 flex flex-col gap-1.5">
                  {group.breakdown.map((b) => (
                    <div key={b.id} className="flex items-center gap-2 text-[11.5px]">
                      <span className="font-mono font-bold text-teal">{b.batchCode}</span>
                      <span className="text-steel">· {fmt(b.createdAt)}</span>
                      <span className="ml-auto text-red font-semibold">{b.damagedQty} dañadas</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
