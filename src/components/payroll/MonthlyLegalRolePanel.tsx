"use client";

import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { ProofPreview } from "@/components/shared/ProofPreview";
import { formatDateTime } from "@/lib/formatDateTime";

type Role = {
  id: string;
  month: string;
  version: number;
  isCurrent: boolean;
  changeNote: string | null;
  declaredSalary: number;
  iessDeduction: number;
  netTotal: number;
  publishedAt: string;
  paidAt: string | null;
  payoutProofUrl: string | null;
  payoutProofName: string | null;
};

const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

function money(n: number) {
  return `$${n.toFixed(2)}`;
}
function monthLabel(month: string) {
  const [y, m] = month.split("-");
  return `${MONTHS[Number(m) - 1]} ${y}`;
}

// Confirmado 2026-08-13: pedido explícito del usuario — cada colaborador ve
// SOLO su "Rol del mes" (nunca "quincena", para que no parezca que falta
// otro), calculado sobre el sueldo declarado en el IESS. Nunca el detalle
// real quincenal — eso es exclusivo de Nairoby y el admin.
export function MonthlyLegalRolePanel() {
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [showingPrev, setShowingPrev] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetch("/api/payroll/my-monthly-role").then((r) => (r.ok ? r.json() : [])).then(setRoles);
  }, []);

  if (!roles) return null;
  if (roles.length === 0) return null;

  const byMonth = new Map<string, Role[]>();
  for (const r of roles) {
    if (!byMonth.has(r.month)) byMonth.set(r.month, []);
    byMonth.get(r.month)!.push(r);
  }
  const months = [...byMonth.keys()].sort().reverse();

  return (
    <div className="mb-6">
      <div className="font-semibold text-[13.5px] mb-3">Rol del mes</div>
      <div className="flex flex-col gap-2.5">
        {months.map((month) => {
          const versions = byMonth.get(month)!.sort((a, b) => b.version - a.version);
          const current = versions.find((v) => v.isCurrent) ?? versions[0];
          const previous = versions.filter((v) => v.id !== current.id);
          const open = !!showingPrev[month];
          return (
            <div key={month} className="bg-surface border border-rule rounded p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-bold text-[14px]">{monthLabel(current.month)}</div>
                  <div className="text-[11px] text-steel-dim">Publicado el {formatDateTime(current.publishedAt)}</div>
                </div>
                <div className="text-[18px] font-extrabold text-green tabular-nums">{money(current.netTotal)}</div>
              </div>
              <div className="mt-2.5 text-[12.5px] flex flex-col gap-1">
                <div className="flex justify-between"><span className="text-steel">Sueldo</span><span className="text-green">{money(current.declaredSalary)}</span></div>
                <div className="flex justify-between"><span className="text-steel">Descuento IESS (9.45%)</span><span className="text-red">{money(current.iessDeduction)}</span></div>
                <div className="flex justify-between font-bold border-t border-rule pt-1.5 mt-0.5"><span>Total a recibir</span><span>{money(current.netTotal)}</span></div>
              </div>

              {current.payoutProofUrl && (
                <div className="mt-2.5 pt-2.5 border-t border-rule">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-steel mb-1.5">
                    Comprobante de tu pago{current.paidAt ? ` · ${formatDateTime(current.paidAt)}` : ""}
                  </div>
                  <ProofPreview url={current.payoutProofUrl} filename={current.payoutProofName ?? undefined} />
                </div>
              )}

              <a
                href={`/rol-del-mes/${current.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-blue mt-2.5"
              >
                <FileText size={12} /> Descargar / imprimir PDF
              </a>

              {current.changeNote && (
                <div className="mt-3 p-2.5 rounded bg-gold/10 border border-gold/30 text-[11.5px]" style={{ color: "#D9A441" }}>
                  Este rol se corrigió — {current.changeNote}
                </div>
              )}
              {previous.length > 0 && (
                <button type="button" className="text-[11px] text-blue font-semibold cursor-pointer mt-2" onClick={() => setShowingPrev((s) => ({ ...s, [month]: !s[month] }))}>
                  {open ? "Ocultar versión anterior" : `Ver versión anterior (${previous.length}) →`}
                </button>
              )}
              {open && previous.map((v) => (
                <div key={v.id} className="mt-2 p-2.5 rounded bg-cloud text-[11.5px] text-steel">
                  Versión {v.version} — {money(v.netTotal)} a recibir · publicado el {formatDateTime(v.publishedAt)}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
