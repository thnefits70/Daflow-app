"use client";

import { useEffect, useState } from "react";
import { CalendarClock, CheckCircle2, ChevronDown, ChevronUp, Flame, PackageMinus, ShieldCheck, Wrench } from "lucide-react";

type BreakdownRow = { id: string; batchCode: string; damagedQty: number; createdAt: string; disposalDecision: boolean | null };
type GroupDTO = { name: string; totalDamagedQty: number; damageReasonLabel: string | null; photoUrl: string | null; itemIds: string[]; breakdown: BreakdownRow[] };
type WeeklyBatchDTO = {
  id: string;
  weekStart: string;
  weekEnd: string;
  justWrittenOffAt: string | null;
  justWrittenOffByName: string | null;
  nairobyConfirmedAt: string | null;
  nairobyConfirmedByName: string | null;
  groups: GroupDTO[];
};
type SummaryDTO = { currentWeek: WeeklyBatchDTO | null; needsJustWriteOff: WeeklyBatchDTO[]; needsNairobyVerification: WeeklyBatchDTO[]; needsDisposalDecision: WeeklyBatchDTO[] };

function fmtDay(iso: string) {
  return new Date(iso).toLocaleDateString("es-EC", { day: "2-digit", month: "short" });
}
function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("es-EC", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
function weekLabel(b: { weekStart: string; weekEnd: string }) {
  return `Semana ${fmtDay(b.weekStart)} – ${fmtDay(b.weekEnd)}`;
}

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "Ocurrió un error.");
  return data;
}

function GroupList({ groups, totalLabel }: { groups: GroupDTO[]; totalLabel: (g: GroupDTO) => string }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      {groups.map((g) => (
        <div key={g.name} className="bg-cloud border border-rule rounded-md overflow-hidden">
          <div className="p-2.5 flex items-center gap-2.5">
            {g.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={g.photoUrl} alt={g.name} className="w-8 h-8 object-cover rounded border border-rule shrink-0" />
            ) : (
              <span className="w-8 h-8 shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-[12px] truncate">{g.name}</div>
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-red font-semibold">{totalLabel(g)}</span>
                {g.damageReasonLabel && <span className="font-mono text-[9px] text-steel bg-surface rounded-full px-1.5 py-0.5">{g.damageReasonLabel}</span>}
              </div>
            </div>
            {g.breakdown.length > 1 && (
              <button
                type="button"
                title="Ver desglose por lote"
                className="w-6 h-6 shrink-0 rounded border border-rule flex items-center justify-center cursor-pointer text-steel hover:text-teal"
                onClick={() => setExpanded(expanded === g.name ? null : g.name)}
              >
                {expanded === g.name ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>
            )}
          </div>
          {expanded === g.name && (
            <div className="bg-surface border-t border-rule p-2.5 flex flex-col gap-1">
              {g.breakdown.map((b) => (
                <div key={b.id} className="flex items-center gap-2 text-[11px]">
                  <span className="font-mono font-bold text-teal">{b.batchCode}</span>
                  <span className="text-steel">· {fmtDateTime(b.createdAt)}</span>
                  <span className="ml-auto text-red font-semibold">{b.damagedQty} dañadas</span>
                  {b.disposalDecision !== null && (
                    <span className={`font-mono text-[9px] font-bold rounded-full px-1.5 py-0.5 ${b.disposalDecision ? "text-teal bg-teal/15 border border-teal/40" : "text-red bg-red/15 border border-red/40"}`}>
                      {b.disposalDecision ? "Percha de repuestos" : "Destruido"}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function CurrentWeekCard({ batch }: { batch: WeeklyBatchDTO | null }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2.5">
        <CalendarClock size={15} className="text-steel" />
        <span className="text-[13.5px] font-bold">Acumulado de esta semana</span>
        <span className="font-mono text-[9.5px] text-steel bg-cloud rounded-full px-1.5 py-0.5">solo lectura</span>
      </div>
      {!batch || batch.groups.length === 0 ? (
        <div className="text-[12px] text-steel border-[1.5px] border-dashed border-rule rounded-md p-5 text-center">Nada dañado sin solucionar esta semana, por ahora.</div>
      ) : (
        <div>
          <div className="text-[11px] text-steel mb-2">{weekLabel(batch)} · corte el sábado</div>
          <GroupList groups={batch.groups} totalLabel={(g) => `${g.totalDamagedQty} unidades${g.breakdown.length > 1 ? ` · ${g.breakdown.length} lotes` : ""}`} />
        </div>
      )}
    </div>
  );
}

function JustWriteOffCard({ batch, onChanged }: { batch: WeeklyBatchDTO; onChanged: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setBusy(true);
    setError("");
    try {
      await postJson(`/api/merchandise-reentry/weekly-writeoff/${batch.id}/just-writeoff`);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
      setBusy(false);
    }
  }

  return (
    <div className="bg-surface border border-rule rounded-md p-3.5">
      <div className="text-[12.5px] font-semibold mb-2">{weekLabel(batch)}</div>
      <GroupList groups={batch.groups} totalLabel={(g) => `${g.totalDamagedQty} unidades${g.breakdown.length > 1 ? ` · ${g.breakdown.length} lotes` : ""}`} />
      {!confirming ? (
        <button type="button" disabled={busy} className="mt-3 rounded border border-red bg-red px-3 py-1.5 text-[11.5px] font-bold text-white cursor-pointer disabled:opacity-60" onClick={() => setConfirming(true)}>
          Lote dado de baja por producto dañado
        </button>
      ) : (
        <div className="mt-3 bg-cloud border border-rule rounded-md p-3">
          <div className="text-[11.5px] mb-2">
            Confirma que ya diste de baja este listado en el sistema Just. Después de esto, el lote pasa a <b>Nairoby</b>: ella verificará físicamente los productos contra este listado, hará la doble
            confirmación, y decidirá si se destruyen o pasan a la percha de repuestos. Tu parte termina acá.
          </div>
          <div className="flex gap-1.5">
            <button type="button" disabled={busy} className="rounded border border-red bg-red px-3 py-1.5 text-[11.5px] font-bold text-white cursor-pointer disabled:opacity-60" onClick={submit}>
              Sí, ya di de baja en Just
            </button>
            <button type="button" disabled={busy} className="rounded border border-rule px-3 py-1.5 text-[11.5px] font-semibold cursor-pointer disabled:opacity-60" onClick={() => setConfirming(false)}>
              Cancelar
            </button>
          </div>
        </div>
      )}
      {error && <div className="text-red text-[11px] mt-1.5">{error}</div>}
    </div>
  );
}

function VerificationCard({ batch, onChanged }: { batch: WeeklyBatchDTO; onChanged: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setBusy(true);
    setError("");
    try {
      await postJson(`/api/merchandise-reentry/weekly-writeoff/${batch.id}/confirm`);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
      setBusy(false);
    }
  }

  return (
    <div className="bg-surface border border-red/40 rounded-md p-3.5">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-[12.5px] font-semibold">{weekLabel(batch)}</div>
        <span className="text-[10.5px] text-steel">Daniel dio de baja en Just · {batch.justWrittenOffByName ?? "—"} · {batch.justWrittenOffAt && fmtDateTime(batch.justWrittenOffAt)}</span>
      </div>
      <GroupList groups={batch.groups} totalLabel={(g) => `${g.totalDamagedQty} unidades${g.breakdown.length > 1 ? ` · ${g.breakdown.length} lotes` : ""}`} />
      <div className="text-[11px] text-steel mt-2">Verifica físicamente estos productos en el área de dañados antes de confirmar.</div>
      {!confirming ? (
        <button type="button" disabled={busy} className="mt-2.5 rounded border border-teal bg-teal px-3 py-1.5 text-[11.5px] font-bold text-navy cursor-pointer disabled:opacity-60 flex items-center gap-1.5" onClick={() => setConfirming(true)}>
          <ShieldCheck size={13} /> Ya verifiqué, confirmar baja
        </button>
      ) : (
        <div className="mt-2.5 bg-cloud border border-rule rounded-md p-3">
          <div className="text-[11.5px] mb-2">¿Confirmas que estos productos coinciden con lo dado de baja en Just y que efectivamente se dan de baja?</div>
          <div className="flex gap-1.5">
            <button type="button" disabled={busy} className="rounded border border-teal bg-teal px-3 py-1.5 text-[11.5px] font-bold text-navy cursor-pointer disabled:opacity-60" onClick={submit}>
              Sí, confirmar
            </button>
            <button type="button" disabled={busy} className="rounded border border-rule px-3 py-1.5 text-[11.5px] font-semibold cursor-pointer disabled:opacity-60" onClick={() => setConfirming(false)}>
              Cancelar
            </button>
          </div>
        </div>
      )}
      {error && <div className="text-red text-[11px] mt-1.5">{error}</div>}
    </div>
  );
}

function DisposalCard({ batch, onChanged }: { batch: WeeklyBatchDTO; onChanged: () => void }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function decide(group: GroupDTO, decision: boolean) {
    const pendingIds = group.breakdown.filter((b) => b.disposalDecision === null).map((b) => b.id);
    if (pendingIds.length === 0) return;
    setBusyId(group.name);
    setError("");
    try {
      await postJson("/api/merchandise-reentry/weekly-writeoff/items/disposal", { itemIds: pendingIds, decision });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="bg-surface border border-rule rounded-md p-3.5">
      <div className="text-[12.5px] font-semibold mb-2.5">{weekLabel(batch)} · verificado por {batch.nairobyConfirmedByName ?? "—"}</div>
      <div className="flex flex-col gap-2">
        {batch.groups.map((g) => {
          const pending = g.breakdown.some((b) => b.disposalDecision === null);
          return (
            <div key={g.name} className="bg-cloud border border-rule rounded-md p-2.5">
              <div className="flex items-center gap-2.5">
                {g.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={g.photoUrl} alt={g.name} className="w-8 h-8 object-cover rounded border border-rule shrink-0" />
                ) : (
                  <span className="w-8 h-8 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] truncate">{g.name}</div>
                  <span className="text-[11px] text-red font-semibold">{g.totalDamagedQty} unidades</span>
                </div>
                {pending ? (
                  <div className="shrink-0 flex gap-1.5">
                    <button
                      type="button"
                      disabled={busyId === g.name}
                      className="rounded border border-red bg-red px-2.5 py-1.5 text-[11px] font-bold text-white cursor-pointer disabled:opacity-50 flex items-center gap-1"
                      onClick={() => decide(g, false)}
                    >
                      <Flame size={11} /> Destruir
                    </button>
                    <button
                      type="button"
                      disabled={busyId === g.name}
                      className="rounded border border-teal bg-teal px-2.5 py-1.5 text-[11px] font-bold text-navy cursor-pointer disabled:opacity-50 flex items-center gap-1"
                      onClick={() => decide(g, true)}
                    >
                      <Wrench size={11} /> Percha de repuestos
                    </button>
                  </div>
                ) : (
                  <span className="shrink-0 font-mono text-[10px] font-bold text-steel bg-surface rounded-full px-2 py-0.5">Resuelto</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {error && <div className="text-red text-[11px] mt-1.5">{error}</div>}
    </div>
  );
}

// Control de Daños — ciclo semanal de productos "no solucionados" (ver
// ReviewInbox.tsx: Daniel decide Solucionado/No solucionado al confirmar
// el daño). Pedido 2026-08-21: evita el doble proceso reingreso+baja,
// deja constancia semanal antes de dar de baja en Just, y agrega
// verificación física + disposición final a cargo de Nairoby.
export function WeeklyDamageControl({ canAct, canClose }: { canAct: boolean; canClose: boolean }) {
  const [data, setData] = useState<SummaryDTO | null>(null);
  const [loading, setLoading] = useState(true);

  function load() {
    fetch("/api/merchandise-reentry/weekly-writeoff")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ currentWeek: null, needsJustWriteOff: [], needsNairobyVerification: [], needsDisposalDecision: [] }))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  if (loading || !data) return <div className="text-[13px] text-steel">Cargando…</div>;

  return (
    <div className="flex flex-col gap-6">
      <CurrentWeekCard batch={data.currentWeek} />

      {canAct && data.needsJustWriteOff.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2.5">
            <PackageMinus size={15} className="text-red" />
            <span className="text-[13.5px] font-bold">Semanas cerradas, pendientes de baja en Just</span>
            <span className="font-mono text-[10px] font-bold text-red bg-red/15 border border-red/40 rounded-full px-2 py-0.5">{data.needsJustWriteOff.length}</span>
          </div>
          <div className="flex flex-col gap-2.5">
            {data.needsJustWriteOff.map((b) => (
              <JustWriteOffCard key={b.id} batch={b} onChanged={load} />
            ))}
          </div>
        </div>
      )}

      {canClose && data.needsNairobyVerification.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2.5">
            <ShieldCheck size={15} className="text-red" />
            <span className="text-[13.5px] font-bold">Pendiente de tu verificación</span>
            <span className="font-mono text-[10px] font-bold text-red bg-red/15 border border-red/40 rounded-full px-2 py-0.5">{data.needsNairobyVerification.length}</span>
          </div>
          <div className="flex flex-col gap-2.5">
            {data.needsNairobyVerification.map((b) => (
              <VerificationCard key={b.id} batch={b} onChanged={load} />
            ))}
          </div>
        </div>
      )}

      {canClose && data.needsDisposalDecision.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2.5">
            <Flame size={15} className="text-red" />
            <span className="text-[13.5px] font-bold">Pendiente de disposición final</span>
            <span className="font-mono text-[10px] font-bold text-red bg-red/15 border border-red/40 rounded-full px-2 py-0.5">{data.needsDisposalDecision.length}</span>
          </div>
          <div className="flex flex-col gap-2.5">
            {data.needsDisposalDecision.map((b) => (
              <DisposalCard key={b.id} batch={b} onChanged={load} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
