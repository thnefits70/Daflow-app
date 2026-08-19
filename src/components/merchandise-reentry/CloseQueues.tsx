"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, PackageMinus } from "lucide-react";

type ItemDTO = {
  id: string;
  photoUrls: string[];
  catalogItem: { name: string } | null;
  correctedName: string | null;
  declaredName: string | null;
  goodQty: number;
  damagedQty: number;
  damageReason: { name: string } | null;
  damageReasonOther: string | null;
  batch: { code: string };
  createdAt: string;
};

function itemName(item: ItemDTO) {
  return item.correctedName ?? item.catalogItem?.name ?? item.declaredName ?? "Producto sin nombre";
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString("es-EC", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function CloseQueues() {
  const [forJust, setForJust] = useState<ItemDTO[]>([]);
  const [forWriteOff, setForWriteOff] = useState<ItemDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

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

  async function markJustUploaded(id: string) {
    setBusyId(id);
    await fetch(`/api/merchandise-reentry/items/${id}/just-uploaded`, { method: "POST" }).catch(() => null);
    setBusyId(null);
    load();
  }

  async function markWriteOff(id: string) {
    setBusyId(id);
    await fetch(`/api/merchandise-reentry/items/${id}/write-off`, { method: "POST" }).catch(() => null);
    setBusyId(null);
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
          {forJust.map((item) => (
            <div key={item.id} className="bg-surface border border-rule rounded-md p-3.5">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="font-mono text-[10.5px] font-bold text-teal">{item.batch.code}</span>
                <span className="text-[11px] text-steel">· {fmt(item.createdAt)}</span>
              </div>
              <div className="text-[12.5px] mb-2">{itemName(item)}</div>
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-green font-semibold">{item.goodQty} unidades buenas</span>
                <button type="button" disabled={busyId === item.id} className="rounded border border-teal bg-teal px-3 py-1.5 text-[11.5px] font-bold text-navy cursor-pointer disabled:opacity-60" onClick={() => markJustUploaded(item.id)}>
                  ✓ Subido a Just
                </button>
              </div>
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
          {forWriteOff.map((item) => (
            <div key={item.id} className="bg-surface border border-rule rounded-md p-3.5">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="font-mono text-[10.5px] font-bold text-teal">{item.batch.code}</span>
                <span className="text-[11px] text-steel">· {fmt(item.createdAt)}</span>
              </div>
              <div className="text-[12.5px] mb-1">{itemName(item)}</div>
              <div className="flex items-center gap-1.5 mb-2">
                <span className="text-[12px] text-red font-semibold">{item.damagedQty} unidades dañadas</span>
                {(item.damageReason?.name || item.damageReasonOther) && (
                  <span className="font-mono text-[9.5px] text-steel bg-cloud rounded-full px-1.5 py-0.5">{item.damageReason?.name ?? item.damageReasonOther}</span>
                )}
              </div>
              <div className="flex items-center justify-between">
                {item.photoUrls[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.photoUrls[0]} alt={itemName(item)} className="w-8 h-8 object-cover rounded border border-rule" />
                ) : (
                  <span />
                )}
                <button type="button" disabled={busyId === item.id} className="rounded border border-red bg-red px-3 py-1.5 text-[11.5px] font-bold text-white cursor-pointer disabled:opacity-60" onClick={() => markWriteOff(item.id)}>
                  Registrar baja
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
