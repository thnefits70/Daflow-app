"use client";

import { useEffect, useState } from "react";
import { RefreshCw, Truck } from "lucide-react";
import { CatalogCode } from "@/components/shared/CatalogCode";
import { formatDateTime } from "@/lib/formatDateTime";

type TeamMember = { id: string; name: string };
type SaleItemDTO = {
  id: string;
  declaredProductName: string;
  catalogItem: { name: string; photos: string[]; justCode: string | null } | null;
  quantity: number;
  sellerReferencePhotoUrl: string | null;
};
type SaleDTO = {
  id: string;
  code: string;
  createdAt: string;
  items: SaleItemDTO[];
  pickupPersonName: string;
  advisor: { name: string } | null;
};
type InProgressDTO = SaleDTO & { dispatchAssignedAt: string | null; dispatchAssignedTo: { id: string; name: string } | null };

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "Ocurrió un error.");
  return data;
}

function SaleItems({ s }: { s: SaleDTO }) {
  return (
    <>
      <div className="flex flex-col gap-1.5">
        {s.items.map((it) => {
          const photo = it.catalogItem?.photos[0] ?? it.sellerReferencePhotoUrl ?? null;
          const isReference = !it.catalogItem?.photos[0] && !!it.sellerReferencePhotoUrl;
          return (
            <div key={it.id} className="flex items-center gap-2">
              {photo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={photo}
                  alt={it.catalogItem?.name ?? it.declaredProductName}
                  title={isReference ? "Foto de referencia del asesor (el producto no está matriculado)" : undefined}
                  className={`w-10 h-10 object-cover rounded border shrink-0 ${isReference ? "border-gold/60" : "border-rule"}`}
                />
              )}
              <div className="min-w-0">
                <div className="text-[13px] font-semibold flex items-center gap-1.5 flex-wrap">
                  {it.catalogItem && <CatalogCode code={it.catalogItem.justCode} />}
                  <span>{it.catalogItem?.name ?? it.declaredProductName} — {it.quantity} un.</span>
                </div>
                {isReference && <div className="text-[10px] text-gold">Foto de referencia del asesor — producto sin matricular</div>}
              </div>
            </div>
          );
        })}
      </div>
      <div className="text-[11.5px] text-steel mb-2.5">Entrega a: {s.pickupPersonName}</div>
    </>
  );
}

export function ExternalSaleDispatchInbox() {
  const [sales, setSales] = useState<SaleDTO[] | null>(null);
  const [inProgress, setInProgress] = useState<InProgressDTO[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [colaboradorId, setColaboradorId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function load() {
    fetch("/api/external-sales/pending-dispatch")
      .then((r) => r.json())
      .then((data) => { setSales(data.sales ?? []); setInProgress(data.inProgress ?? []); setTeam(data.team ?? []); })
      .catch(() => setSales([]));
  }
  useEffect(load, []);

  async function assign(id: string, reassign = false) {
    if (!colaboradorId) return;
    setSaving(true);
    setError("");
    try {
      await postJson(`/api/external-sales/${id}/assign-dispatch`, { colaboradorId, reassign });
      setAssigning(null);
      setColaboradorId("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo asignar.");
    } finally {
      setSaving(false);
    }
  }

  function assignBox(id: string, reassign: boolean, currentId?: string) {
    return (
      <div className="bg-cloud rounded-md p-2.5">
        <select className="w-full rounded border border-rule bg-surface px-2.5 py-1.5 text-[12.5px] mb-2" value={colaboradorId} onChange={(e) => setColaboradorId(e.target.value)}>
          <option value="">Elegir colaborador…</option>
          {team.filter((m) => m.id !== currentId).map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        {error && <div className="text-red text-[11px] mb-1.5">{error}</div>}
        <div className="flex gap-2">
          <button type="button" className="flex-1 rounded border border-rule px-2.5 py-1.5 text-[11.5px] font-semibold cursor-pointer" onClick={() => { setAssigning(null); setError(""); }}>Cancelar</button>
          <button type="button" disabled={saving || !colaboradorId} className="flex-1 rounded border border-teal bg-teal px-2.5 py-1.5 text-[11.5px] font-bold text-navy cursor-pointer disabled:opacity-40" onClick={() => assign(id, reassign)}>
            {saving ? "Asignando…" : reassign ? "Reasignar" : "Asignar"}
          </button>
        </div>
      </div>
    );
  }

  function open(id: string) {
    setAssigning(id);
    setColaboradorId("");
    setError("");
  }

  if (sales === null) return <div className="text-[13px] text-steel">Cargando…</div>;

  return (
    <div className="flex flex-col gap-2.5 max-w-lg">
      {sales.length === 0 && <div className="text-[13px] text-steel">No hay ventas pendientes de asignar agrupación.</div>}
      {sales.map((s) => (
        <div key={s.id} className="bg-surface border border-rule rounded-md p-3.5">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="font-mono text-[11px] font-bold text-teal">{s.code}</span>{s.code.startsWith("GL-") && <span className="font-mono text-[9.5px] font-bold uppercase rounded-full px-1.5 py-0.5 border border-gold/50 bg-gold/15">Garantía</span>}
            <span className="text-[11px] text-steel">{s.advisor?.name ?? "—"}</span>
            <span className="text-[10.5px] text-steel/70 ml-auto">{formatDateTime(s.createdAt)}</span>
          </div>
          <SaleItems s={s} />
          {assigning === s.id ? assignBox(s.id, false) : (
            <button type="button" className="flex items-center gap-1.5 text-[11.5px] font-bold border border-teal text-teal rounded px-2.5 py-1.5 cursor-pointer" onClick={() => open(s.id)}>
              <Truck size={13} /> Asignar agrupación
            </button>
          )}
        </div>
      ))}

      {/* 2026-10-01, pedido de Marcos: las ya asignadas que todavía no se
          agrupan, para que Daniel vea quién la tiene y pueda reasignarla si
          esa persona no avanza. */}
      {inProgress.length > 0 && (
        <>
          <div className="text-[12px] font-bold text-steel uppercase tracking-wide mt-3">Ya asignadas — esperando que agrupen</div>
          {inProgress.map((s) => (
            <div key={s.id} className="bg-surface border border-rule rounded-md p-3.5">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="font-mono text-[11px] font-bold text-teal">{s.code}</span>{s.code.startsWith("GL-") && <span className="font-mono text-[9.5px] font-bold uppercase rounded-full px-1.5 py-0.5 border border-gold/50 bg-gold/15">Garantía</span>}
                <span className="text-[11px] text-steel">{s.advisor?.name ?? "—"}</span>
              </div>
              <SaleItems s={s} />
              <div className="text-[11.5px] text-gold mb-2.5">
                Asignada a {s.dispatchAssignedTo?.name ?? "—"}{s.dispatchAssignedAt ? ` · ${formatDateTime(s.dispatchAssignedAt)}` : ""}
              </div>
              {assigning === s.id ? assignBox(s.id, true, s.dispatchAssignedTo?.id) : (
                <button type="button" className="flex items-center gap-1.5 text-[11.5px] font-bold border border-rule text-steel rounded px-2.5 py-1.5 cursor-pointer hover:text-ink" onClick={() => open(s.id)}>
                  <RefreshCw size={13} /> Reasignar a otra persona
                </button>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
