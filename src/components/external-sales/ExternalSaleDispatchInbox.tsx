"use client";

import { useEffect, useState } from "react";
import { Truck } from "lucide-react";

type TeamMember = { id: string; name: string };
type SaleDTO = {
  id: string;
  code: string;
  declaredProductName: string;
  catalogItem: { name: string; photos: string[] } | null;
  quantity: number;
  pickupPersonName: string;
  advisor: { name: string } | null;
};

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "Ocurrió un error.");
  return data;
}

export function ExternalSaleDispatchInbox() {
  const [sales, setSales] = useState<SaleDTO[] | null>(null);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [colaboradorId, setColaboradorId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function load() {
    fetch("/api/external-sales/pending-dispatch")
      .then((r) => r.json())
      .then((data) => { setSales(data.sales ?? []); setTeam(data.team ?? []); })
      .catch(() => setSales([]));
  }
  useEffect(load, []);

  async function assign(id: string) {
    if (!colaboradorId) return;
    setSaving(true);
    setError("");
    try {
      await postJson(`/api/external-sales/${id}/assign-dispatch`, { colaboradorId });
      setAssigning(null);
      setColaboradorId("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo asignar.");
    } finally {
      setSaving(false);
    }
  }

  if (sales === null) return <div className="text-[13px] text-steel">Cargando…</div>;
  if (sales.length === 0) return <div className="text-[13px] text-steel">No hay ventas pendientes de asignar despacho.</div>;

  return (
    <div className="flex flex-col gap-2.5 max-w-lg">
      {sales.map((s) => (
        <div key={s.id} className="bg-surface border border-rule rounded-md p-3.5">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="font-mono text-[11px] font-bold text-teal">{s.code}</span>
            <span className="text-[11px] text-steel">{s.advisor?.name ?? "—"}</span>
          </div>
          <div className="text-[13px] font-semibold">{s.catalogItem?.name ?? s.declaredProductName} — {s.quantity} un.</div>
          <div className="text-[11.5px] text-steel mb-2.5">Entrega a: {s.pickupPersonName}</div>

          {assigning === s.id ? (
            <div className="bg-cloud rounded-md p-2.5">
              <select className="w-full rounded border border-rule bg-surface px-2.5 py-1.5 text-[12.5px] mb-2" value={colaboradorId} onChange={(e) => setColaboradorId(e.target.value)}>
                <option value="">Elegir colaborador…</option>
                {team.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
              {error && <div className="text-red text-[11px] mb-1.5">{error}</div>}
              <div className="flex gap-2">
                <button type="button" className="flex-1 rounded border border-rule px-2.5 py-1.5 text-[11.5px] font-semibold cursor-pointer" onClick={() => setAssigning(null)}>Cancelar</button>
                <button type="button" disabled={saving || !colaboradorId} className="flex-1 rounded border border-teal bg-teal px-2.5 py-1.5 text-[11.5px] font-bold text-navy cursor-pointer disabled:opacity-40" onClick={() => assign(s.id)}>
                  {saving ? "Asignando…" : "Asignar"}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="flex items-center gap-1.5 text-[11.5px] font-bold border border-teal text-teal rounded px-2.5 py-1.5 cursor-pointer" onClick={() => setAssigning(s.id)}>
              <Truck size={13} /> Asignar despacho
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
