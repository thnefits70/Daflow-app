"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { ProofPreview } from "@/components/shared/ProofPreview";

type Entry = {
  roleId: string;
  period: string;
  quincena: "1-15" | "16-fin";
  employeeName: string;
  position: string | null;
  netTotal: number;
  paidAt: string | null;
  paidProofUrl: string | null;
  paidProofName: string | null;
};

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

const ECUADOR_UTC_OFFSET_HOURS = 5;
function nowInEcuador(): Date {
  return new Date(Date.now() - ECUADOR_UTC_OFFSET_HOURS * 3600 * 1000);
}
const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
function monthLabel(month: string) {
  const [y, m] = month.split("-");
  return `${MONTHS[Number(m) - 1]} ${y}`;
}
function recentMonths(): string[] {
  const out: string[] = [];
  const now = nowInEcuador();
  for (let i = 0; i < 8; i++) {
    const d = new Date(now.getUTCFullYear(), now.getUTCMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}
function currentMonth(): string {
  const now = nowInEcuador();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Confirmado 2026-08-24: pedido explícito del usuario — un registro interno
// (Nairoby/admin) de los pagos individuales que se van confirmando cada
// mes, para revisar de un vistazo quién quedó pagado en cada quincena.
// Nunca visible para el colaborador — mismo gate que "Rol de pago".
export function PayrollPaymentHistoryPanel() {
  const months = useMemo(recentMonths, []);
  const [month, setMonth] = useState(currentMonth);
  const [entries, setEntries] = useState<Entry[] | null>(null);

  useEffect(() => {
    setEntries(null);
    fetch(`/api/payroll/monthly-payment-history?month=${month}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setEntries(data?.entries ?? []));
  }, [month]);

  const paidCount = entries?.filter((e) => e.paidAt).length ?? 0;

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <select className="rounded border border-rule bg-surface px-2.5 py-2 text-[13px]" value={month} onChange={(e) => setMonth(e.target.value)}>
          {months.map((m) => (
            <option key={m} value={m}>{monthLabel(m)}</option>
          ))}
        </select>
        {entries && entries.length > 0 && (
          <span className={`text-[11px] font-semibold rounded-full px-2.5 py-1 ${paidCount === entries.length ? "text-green bg-green/10" : "text-steel bg-cloud"}`}>
            {paidCount}/{entries.length} pagados
          </span>
        )}
      </div>

      {entries === null && <div className="text-[12.5px] text-steel-dim">Cargando…</div>}
      {entries && entries.length === 0 && <div className="text-[12.5px] text-steel-dim italic">Sin roles generados este mes.</div>}

      {entries && entries.length > 0 && (
        <div className="flex flex-col gap-2">
          {entries.map((e) => (
            <div key={e.roleId} className={`border rounded-md p-3 flex items-center justify-between gap-3 flex-wrap ${e.paidAt ? "border-green/30 bg-green/5" : "border-rule bg-surface"}`}>
              <div>
                <div className="font-semibold text-[12.5px]">{e.employeeName}</div>
                <div className="text-[10.5px] text-steel">{e.position ?? ""} · Quincena {e.quincena}</div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[13px] font-bold tabular-nums">{money(e.netTotal)}</span>
                {e.paidAt ? (
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-green font-semibold flex items-center gap-1">
                      <CheckCircle2 size={12} /> {new Date(e.paidAt).toLocaleDateString("es-EC")}
                    </span>
                    {e.paidProofUrl && <ProofPreview url={e.paidProofUrl} filename={e.paidProofName ?? undefined} />}
                  </div>
                ) : (
                  <span className="text-[11px]" style={{ color: "#D9A441" }}>Pendiente</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
