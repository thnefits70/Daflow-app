"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, PackageMinus, TrendingUp } from "lucide-react";
import { CatalogCode } from "@/components/shared/CatalogCode";

type ItemDTO = {
  id: string;
  declaredName: string;
  quantity: number;
  photoUrls: string[];
  catalogItem: { name: string; photos: string[]; justCode: string | null } | null;
  damageReason: { name: string } | null;
  damageReasonOther: string | null;
  batch: { code: string; createdAt: string; createdBy: { name: string } | null };
};

type Resolution = "SOLVED_ONSITE" | "WRITE_OFF" | "ESCALATED_TO_PURCHASES";

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "Ocurrió un error.");
  return data;
}

function itemName(item: ItemDTO) {
  return item.catalogItem?.name ?? item.declaredName;
}

export function DeteriorResolutionInbox({ canAct }: { canAct: boolean }) {
  const [items, setItems] = useState<ItemDTO[] | null>(null);
  const [choosing, setChoosing] = useState<{ id: string; resolution: Resolution } | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function load() {
    fetch("/api/merchandise-outflow/deterioro")
      .then((r) => r.json())
      .then(setItems)
      .catch(() => setItems([]));
  }
  useEffect(load, []);

  async function resolve() {
    if (!choosing) return;
    setSaving(true);
    setError("");
    try {
      await postJson(`/api/merchandise-outflow/items/${choosing.id}/resolve`, { resolution: choosing.resolution, note: note.trim() || undefined });
      setChoosing(null);
      setNote("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo resolver.");
    } finally {
      setSaving(false);
    }
  }

  if (items === null) return <div className="text-[13px] text-steel">Cargando…</div>;
  if (items.length === 0) return <div className="text-[13px] text-steel">No hay deterioros pendientes de resolución.</div>;

  return (
    <div className="flex flex-col gap-2.5 max-w-lg">
      {items.map((item) => (
        <div key={item.id} className="bg-surface border border-rule rounded-md p-3.5">
          <div className="flex items-center gap-3 mb-2.5">
            {item.photoUrls[0] && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.photoUrls[0]} alt={itemName(item)} className="w-12 h-12 object-cover rounded border border-rule shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold flex items-center gap-1.5 min-w-0">
                {item.catalogItem && <CatalogCode code={item.catalogItem.justCode} />}
                <span className="truncate">{itemName(item)}</span>
              </div>
              <div className="text-[11px] text-steel">{item.quantity} un. · {item.damageReason?.name ?? item.damageReasonOther ?? "Sin motivo"}</div>
              <div className="text-[10.5px] text-steel">{item.batch.code} · {item.batch.createdBy?.name ?? "—"}</div>
            </div>
          </div>

          {!canAct ? (
            <div className="text-[11.5px] text-steel">Solo Daniel puede resolver este reporte.</div>
          ) : choosing?.id === item.id ? (
            <div className="bg-cloud rounded-md p-2.5">
              <div className="text-[12px] font-semibold mb-1.5">
                {choosing.resolution === "SOLVED_ONSITE" ? "¿Confirmar que se solucionó ahí mismo?" : choosing.resolution === "WRITE_OFF" ? "Explica por qué no se puede arreglar" : "Explica qué se va a pedir al proveedor"}
              </div>
              {choosing.resolution !== "SOLVED_ONSITE" && (
                <textarea className="w-full rounded border border-rule bg-surface px-2.5 py-1.5 text-[12px] mb-2" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nota breve…" />
              )}
              {error && <div className="text-red text-[11px] mb-1.5">{error}</div>}
              <div className="flex gap-2">
                <button type="button" className="flex-1 rounded border border-rule px-2.5 py-1.5 text-[11.5px] font-semibold cursor-pointer" onClick={() => { setChoosing(null); setNote(""); setError(""); }}>
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={saving || (choosing.resolution !== "SOLVED_ONSITE" && !note.trim())}
                  className="flex-1 rounded border border-teal bg-teal px-2.5 py-1.5 text-[11.5px] font-bold text-navy cursor-pointer disabled:opacity-40"
                  onClick={resolve}
                >
                  {saving ? "Guardando…" : "Confirmar"}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-1.5 flex-wrap">
              <button type="button" className="flex items-center gap-1 text-[11.5px] font-semibold border border-green/40 text-green rounded-full px-2.5 py-1 cursor-pointer" onClick={() => setChoosing({ id: item.id, resolution: "SOLVED_ONSITE" })}>
                <CheckCircle2 size={12} /> Solucionado ahí mismo
              </button>
              <button type="button" className="flex items-center gap-1 text-[11.5px] font-semibold border border-red/40 text-red rounded-full px-2.5 py-1 cursor-pointer" onClick={() => setChoosing({ id: item.id, resolution: "WRITE_OFF" })}>
                <PackageMinus size={12} /> Dar de baja
              </button>
              <button type="button" className="flex items-center gap-1 text-[11.5px] font-semibold border border-blue/40 text-blue rounded-full px-2.5 py-1 cursor-pointer" onClick={() => setChoosing({ id: item.id, resolution: "ESCALATED_TO_PURCHASES" })}>
                <TrendingUp size={12} /> Escalar a Compras
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
