"use client";

import { useEffect, useState } from "react";
import { Wallet, Lock } from "lucide-react";
import { actorName } from "@/lib/actorName";
import { formatDateTime } from "@/lib/formatDateTime";
import { ProofPreview } from "@/components/shared/ProofPreview";

type PendingCredit = {
  id: string;
  amount: number;
  reason: string;
  status: "AVAILABLE" | "RESERVED";
  createdAt: string;
  proofUrl: string | null;
  proofName: string | null;
  isManual: boolean;
  supplier: { id: string; name: string };
  createdBy: { name: string } | null;
  reservedForCode: string | null;
};

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

// Confirmado 2026-08-12: pedido explícito del usuario — una sola pantalla con
// TODO el crédito vivo de la empresa, de cualquier proveedor. Desaparece de
// acá en cuanto se aplica de verdad (status pasa a APPLIED al pagar). Los
// créditos manuales solo los ve el admin — el servidor ya filtra el resto
// para cualquier otro rol, esta pantalla solo pinta lo que le llega.
export function PurchaseCreditsPanel() {
  const [credits, setCredits] = useState<PendingCredit[] | null>(null);

  useEffect(() => {
    fetch("/api/purchase-suppliers/credits")
      .then((r) => (r.ok ? r.json() : []))
      .then(setCredits)
      .catch(() => setCredits([]));
  }, []);

  if (credits === null) return <div className="text-steel text-[13px]">Cargando…</div>;

  const total = credits.reduce((s, c) => s + c.amount, 0);
  const reservedTotal = credits.filter((c) => c.status === "RESERVED").reduce((s, c) => s + c.amount, 0);

  return (
    <div>
      <div className="flex items-center gap-4 mb-4">
        <div className="bg-surface border border-rule rounded-md px-4 py-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-steel">Crédito vivo total</div>
          <div className="text-[18px] font-bold text-ink">{money(total)}</div>
        </div>
        <div className="bg-surface border border-rule rounded-md px-4 py-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-steel">Ya reservado en solicitudes</div>
          <div className="text-[18px] font-bold text-teal">{money(reservedTotal)}</div>
        </div>
      </div>

      {credits.length === 0 ? (
        <div className="text-steel text-[13.5px]">No hay créditos pendientes con ningún proveedor.</div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {credits.map((c) => (
            <div key={c.id} className="bg-surface border border-rule rounded-md p-3.5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-[13.5px] font-bold text-ink">{c.supplier.name}</div>
                  <div className="text-[12.5px] text-steel">{c.reason}</div>
                </div>
                <div className="text-[15px] font-bold text-ink shrink-0">{money(c.amount)}</div>
              </div>
              <div className="flex items-center flex-wrap gap-2 mt-2">
                {c.status === "RESERVED" ? (
                  <span className="flex items-center gap-1 text-[10.5px] font-semibold text-teal bg-teal/10 border border-teal/35 rounded-full px-2 py-0.5">
                    <Lock size={10} /> Reservado{c.reservedForCode ? ` — ${c.reservedForCode}` : ""}
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[10.5px] font-semibold bg-gold/10 border border-gold/35 rounded-full px-2 py-0.5" style={{ color: "#D9A441" }}>
                    <Wallet size={10} /> Disponible
                  </span>
                )}
                {c.isManual && (
                  <span className="text-[10.5px] font-semibold text-steel bg-cloud border border-rule rounded-full px-2 py-0.5">Manual</span>
                )}
                <span className="text-[10.5px] text-steel-dim">
                  {c.isManual ? `Registrado por ${actorName(c.createdBy?.name)}` : "Automático — reporte urgente resuelto"} · {formatDateTime(c.createdAt)}
                </span>
              </div>
              {c.proofUrl && (
                <div className="mt-2.5">
                  <ProofPreview url={c.proofUrl} filename={c.proofName ?? undefined} size={48} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
