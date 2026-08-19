"use client";

import { useEffect, useState } from "react";
import { Lock } from "lucide-react";

type ItemDTO = {
  id: string;
  catalogItem: { name: string } | null;
  correctedName: string | null;
  declaredName: string | null;
  goodQty: number;
  damagedQty: number;
  approvedBy: { name: string } | null;
  justUploadedBy: { name: string } | null;
  writeOffBy: { name: string } | null;
};

type BatchDTO = {
  id: string;
  code: string;
  createdBy: { name: string } | null;
  submittedAt: string;
  danielApprovedAt: string | null;
  closedAt: string | null;
  items: ItemDTO[];
};

function itemName(item: ItemDTO) {
  return item.correctedName ?? item.catalogItem?.name ?? item.declaredName ?? "Producto sin nombre";
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString("es-EC", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function HistoryList() {
  const [batches, setBatches] = useState<BatchDTO[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/merchandise-reentry/batches/history")
      .then((r) => r.json())
      .then((data) => setBatches(data ?? []))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-[13px] text-steel">Cargando…</div>;
  if (batches.length === 0) return <div className="text-[12.5px] text-steel border-[1.5px] border-dashed border-rule rounded-md p-6 text-center">Todavía no hay lotes enviados.</div>;

  return (
    <div className="flex flex-col gap-3 max-w-2xl">
      {batches.map((b) => (
        <div key={b.id} className="bg-surface border border-rule rounded-md p-4">
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[12px] font-bold text-teal">{b.code}</span>
              <span className="text-[11.5px] text-steel">
                {b.items.map((i) => itemName(i)).join(", ")}
              </span>
            </div>
            <span className="font-mono text-[9.5px] font-bold text-steel bg-cloud border border-rule rounded-full px-2 py-0.5 flex items-center gap-1 whitespace-nowrap">
              <Lock size={9} /> SOLO LECTURA
            </span>
          </div>
          <div className="flex flex-col gap-1.5 text-[12px]">
            <div>
              <b>Capturado por</b> {b.createdBy?.name ?? "—"} · {fmt(b.submittedAt)}
            </div>
            <div className={b.danielApprovedAt ? "" : "text-steel"}>
              <b>Aprobado por</b> {b.items.find((i) => i.approvedBy)?.approvedBy?.name ?? "Inventario (admin)"} · {b.danielApprovedAt ? fmt(b.danielApprovedAt) : "pendiente"}
            </div>
            <div className={b.closedAt ? "" : "text-steel"}>
              <b>Cerrado por</b>{" "}
              {b.items.find((i) => i.justUploadedBy || i.writeOffBy)?.justUploadedBy?.name ??
                b.items.find((i) => i.justUploadedBy || i.writeOffBy)?.writeOffBy?.name ??
                "Finanzas (admin)"}{" "}
              · {b.closedAt ? fmt(b.closedAt) : "pendiente"}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
