"use client";

import { useEffect, useState } from "react";
import { CalendarClock, CheckCircle2, ChevronDown, ChevronUp, Flame, PackageMinus, ShieldCheck, Wrench } from "lucide-react";
import { CatalogCode } from "@/components/shared/CatalogCode";
import { ExpandableName } from "@/components/ui/ExpandableName";

type BreakdownRow = {
  id: string;
  batchCode: string;
  damagedQty: number;
  createdAt: string;
  disposalDecision: boolean | null;
  receivedByName: string | null;
  receivedAt: string | null;
  damageConfirmedByName: string | null;
  damageConfirmedAt: string | null;
  photoUrls: string[];
};
type GroupDTO = { name: string; justCode: string | null; totalDamagedQty: number; damageReasonLabel: string | null; photoUrl: string | null; itemIds: string[]; breakdown: BreakdownRow[] };
type WeeklyBatchDTO = {
  id: string;
  weekStart: string;
  weekEnd: string;
  justWrittenOffAt: string | null;
  nairobyConfirmedAt: string | null;
  nairobyConfirmedByName: string | null;
  groups: GroupDTO[];
};
type SummaryDTO = { currentWeek: WeeklyBatchDTO | null; needsNairobyVerification: WeeklyBatchDTO[]; needsDisposalDecision: WeeklyBatchDTO[] };

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

// Confirmado 2026-09-24, pedido de Nairoby: el respaldo de cada unidad
// antes de confirmar la baja — que es una devolución de cliente (no una
// compra), de qué lote, quién la recibió, quién confirmó el daño y las
// fotos tomadas al recibirla.
function OriginProof({ rows }: { rows: BreakdownRow[] }) {
  return (
    <div className="bg-surface border-t border-rule p-2.5 flex flex-col gap-2">
      {rows.map((b) => (
        <div key={b.id} className="text-[11px] flex flex-col gap-1">
          <div>
            <span className="font-semibold">↩ Devolución de cliente</span> — reingreso <span className="font-mono font-bold text-teal">{b.batchCode}</span>
            {b.receivedByName ? `, recibido por ${b.receivedByName}` : ""}
            {b.receivedAt ? ` el ${fmtDateTime(b.receivedAt)}` : ""} · <span className="text-red font-semibold">{b.damagedQty} dañadas</span>
          </div>
          <div className="text-steel">
            {b.damageConfirmedByName
              ? `✓ ${b.damageConfirmedByName} revisó físicamente, confirmó el daño y no se pudo reparar${b.damageConfirmedAt ? ` (${fmtDateTime(b.damageConfirmedAt)})` : ""}`
              : "Daño confirmado por el líder de bodega"}
          </div>
          {b.photoUrls.length > 0 ? (
            <div className="flex gap-1.5 flex-wrap">
              {b.photoUrls.map((url) => (
                <a key={url} href={url} target="_blank" rel="noreferrer" title="Ver foto en grande">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="Foto al recibir la devolución" className="w-16 h-16 object-cover rounded border border-rule" />
                </a>
              ))}
            </div>
          ) : (
            <div className="text-gold">Sin foto registrada al recibirlo.</div>
          )}
        </div>
      ))}
    </div>
  );
}

function GroupList({ groups, totalLabel, showOrigin = false }: { groups: GroupDTO[]; totalLabel: (g: GroupDTO) => string; showOrigin?: boolean }) {
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
              <div className="text-[12px] flex items-center gap-1.5 min-w-0">
                <CatalogCode code={g.justCode} />
                <ExpandableName text={g.name} />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-red font-semibold">{totalLabel(g)}</span>
                {g.damageReasonLabel && <span className="font-mono text-[9px] text-steel bg-surface rounded-full px-1.5 py-0.5">{g.damageReasonLabel}</span>}
              </div>
            </div>
            {!showOrigin && g.breakdown.length > 1 && (
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
          {showOrigin && <OriginProof rows={g.breakdown} />}
          {!showOrigin && expanded === g.name && (
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

function VerificationCard({ batch, canVerify, onChanged }: { batch: WeeklyBatchDTO; canVerify: boolean; onChanged: () => void }) {
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
        <span className="text-[10.5px] text-steel">Semana cerrada · {batch.justWrittenOffAt && fmtDateTime(batch.justWrittenOffAt)}</span>
      </div>
      <div className="text-[11px] text-steel mb-2">Estos productos no vienen de Compras: son pedidos que el cliente no recibió o devolvió, y regresaron dañados a bodega. Debajo de cada uno ves el respaldo.</div>
      <GroupList showOrigin groups={batch.groups} totalLabel={(g) => `${g.totalDamagedQty} unidades${g.breakdown.length > 1 ? ` · ${g.breakdown.length} lotes` : ""}`} />
      <div className="text-[11px] text-steel mt-2">Revisa las fotos y, si puedes, verifica físicamente estos productos en el área de dañados antes de confirmar.</div>
      {!confirming ? (
        <button
          type="button"
          disabled={busy || !canVerify}
          title={!canVerify ? "Exclusivo de Nairoby" : undefined}
          className="mt-2.5 rounded border border-teal bg-teal px-3 py-1.5 text-[11.5px] font-bold text-navy cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-1.5"
          onClick={() => {
            if (!canVerify) return;
            setConfirming(true);
          }}
        >
          <ShieldCheck size={13} /> Ya verifiqué, confirmar baja
        </button>
      ) : (
        <div className="mt-2.5 bg-cloud border border-rule rounded-md p-3">
          <div className="text-[11.5px] mb-2">¿Confirmas que esta mercadería regresó por devolución, llegó dañada (según las fotos y la revisión de bodega) y se da de baja?</div>
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

function DisposalCard({ batch, canVerify, onChanged }: { batch: WeeklyBatchDTO; canVerify: boolean; onChanged: () => void }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function decide(group: GroupDTO, decision: boolean) {
    if (!canVerify) return;
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
      <div className="text-[12.5px] font-semibold mb-2.5">{weekLabel(batch)} · verificado por {batch.nairobyConfirmedByName ?? "—"}{batch.nairobyConfirmedAt ? ` · ${fmtDateTime(batch.nairobyConfirmedAt)}` : ""}</div>
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
                  <div className="text-[12px] flex items-center gap-1.5 min-w-0">
                    <CatalogCode code={g.justCode} />
                    <ExpandableName text={g.name} />
                  </div>
                  <span className="text-[11px] text-red font-semibold">{g.totalDamagedQty} unidades</span>
                </div>
                {pending ? (
                  <div className="shrink-0 flex gap-1.5">
                    <button
                      type="button"
                      disabled={busyId === g.name || !canVerify}
                      title={!canVerify ? "Exclusivo de Nairoby" : undefined}
                      className="rounded border border-red bg-red px-2.5 py-1.5 text-[11px] font-bold text-white cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                      onClick={() => decide(g, false)}
                    >
                      <Flame size={11} /> Destruir
                    </button>
                    <button
                      type="button"
                      disabled={busyId === g.name || !canVerify}
                      title={!canVerify ? "Exclusivo de Nairoby" : undefined}
                      className="rounded border border-teal bg-teal px-2.5 py-1.5 text-[11px] font-bold text-navy cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
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
// deja constancia semanal (la semana se cierra sola el sábado — ver
// autoCloseFinishedWeeklyWriteOffBatches), y agrega verificación física +
// disposición final a cargo de Nairoby.
export function WeeklyDamageControl({ canAct, canApprove, canClose, canVerify }: { canAct: boolean; canApprove: boolean; canClose: boolean; canVerify: boolean }) {
  const [data, setData] = useState<SummaryDTO | null>(null);
  const [loading, setLoading] = useState(true);

  function load() {
    fetch("/api/merchandise-reentry/weekly-writeoff")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ currentWeek: null, needsNairobyVerification: [], needsDisposalDecision: [] }))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  if (loading || !data) return <div className="text-[13px] text-steel">Cargando…</div>;

  return (
    <div className="flex flex-col gap-6">
      <CurrentWeekCard batch={data.currentWeek} />

      {canClose && data.needsNairobyVerification.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2.5">
            <ShieldCheck size={15} className="text-red" />
            <span className="text-[13.5px] font-bold">Pendiente de tu verificación</span>
            <span className="font-mono text-[10px] font-bold text-red bg-red/15 border border-red/40 rounded-full px-2 py-0.5">{data.needsNairobyVerification.length}</span>
            {!canVerify && <span className="font-mono text-[9.5px] text-steel bg-cloud rounded-full px-1.5 py-0.5">solo lectura</span>}
          </div>
          <div className="flex flex-col gap-2.5">
            {data.needsNairobyVerification.map((b) => (
              <VerificationCard key={b.id} batch={b} canVerify={canVerify} onChanged={load} />
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
            {!canVerify && <span className="font-mono text-[9.5px] text-steel bg-cloud rounded-full px-1.5 py-0.5">solo lectura</span>}
          </div>
          <div className="flex flex-col gap-2.5">
            {data.needsDisposalDecision.map((b) => (
              <DisposalCard key={b.id} batch={b} canVerify={canVerify} onChanged={load} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
