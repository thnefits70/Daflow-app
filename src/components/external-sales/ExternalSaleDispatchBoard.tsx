"use client";

import { useEffect, useState } from "react";
import { Camera, Check, CheckCircle2, Package, RefreshCw, Truck } from "lucide-react";
import { CatalogCode } from "@/components/shared/CatalogCode";
import { LiveCameraCapture } from "@/components/shared/LiveCameraCapture";
import { GuidePrintLink } from "@/components/external-sales/GuidePrintLink";
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
  reviewedAt: string | null;
  createdAt: string;
  items: SaleItemDTO[];
  pickupPersonName: string;
  advisor: { name: string } | null;
  dispatchAssignedTo: { id: string; name: string } | null;
  dispatchAssignedAt: string | null;
  prepReadyAt: string | null;
  prepReadyBy: { name: string } | null;
  prepPhotoUrl: string | null;
  packAssignedTo: { id: string; name: string } | null;
  packAssignedAt: string | null;
  guidePrintedAt: string | null;
  guidePrintedBy: { name: string } | null;
};
type Step = "group" | "pack";

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
                <img loading="lazy" decoding="async"
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
      <div className="text-[11.5px] text-steel mt-1.5 mb-2.5">Entrega a: {s.pickupPersonName}</div>
    </>
  );
}

function StepRow({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5 py-2 border-t border-rule first:border-t-0">
      <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10.5px] font-bold shrink-0 mt-0.5 ${done ? "bg-green/15 text-green" : "bg-cloud text-steel"}`}>
        {done ? <Check size={12} /> : n}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[12.5px] font-bold mb-0.5">{title}</div>
        {children}
      </div>
    </div>
  );
}

// Pedido de Daniel 2026-10-05: antes Agrupar y Embalaje eran dos pestañas
// separadas y la misma venta aparecía en una u otra según el paso. Ahora
// cada venta sale una sola vez con sus 3 pasos y su botón de asignar o
// reasignar en cada uno. El líder sigue sin hacer los pasos él mismo (ver
// feedback_fulfillment_leader_never_self_delivers): solo asigna.
export function ExternalSaleDispatchBoard({ canAssignGroup, canAssignPack }: { canAssignGroup: boolean; canAssignPack: boolean }) {
  const [sales, setSales] = useState<SaleDTO[] | null>(null);
  const [groupTeam, setGroupTeam] = useState<TeamMember[]>([]);
  const [packTeam, setPackTeam] = useState<TeamMember[]>([]);
  const [meId, setMeId] = useState("");
  const [open, setOpen] = useState<{ id: string; step: Step } | null>(null);
  const [colaboradorId, setColaboradorId] = useState("");
  const [preparing, setPreparing] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [taking, setTaking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function load() {
    fetch("/api/external-sales/dispatch-board")
      .then((r) => r.json())
      .then((data) => { setSales(data.sales ?? []); setGroupTeam(data.groupTeam ?? []); setPackTeam(data.packTeam ?? []); setMeId(data.meId ?? ""); })
      .catch(() => setSales([]));
  }
  useEffect(load, []);

  function openAssign(id: string, step: Step) {
    setOpen({ id, step });
    setColaboradorId("");
    setError("");
  }

  async function assign(id: string, step: Step, reassign: boolean) {
    if (!colaboradorId) return;
    setSaving(true);
    setError("");
    try {
      await postJson(`/api/external-sales/${id}/${step === "group" ? "assign-dispatch" : "assign-pack"}`, { colaboradorId, reassign });
      setOpen(null);
      setColaboradorId("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo asignar.");
    } finally {
      setSaving(false);
    }
  }

  async function markReady(id: string) {
    if (!photoUrl) return;
    setSaving(true);
    setError("");
    try {
      await postJson(`/api/external-sales/${id}/prep-ready`, { photoUrl });
      setPreparing(null);
      setPhotoUrl(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo marcar como lista.");
    } finally {
      setSaving(false);
    }
  }

  function assignControl(s: SaleDTO, step: Step, current: { id: string } | null, canChange: boolean) {
    const team = step === "group" ? groupTeam : packTeam;
    if (open?.id === s.id && open.step === step) {
      return (
        <div className="bg-cloud rounded-md p-2.5 mt-1.5">
          <select className="w-full rounded border border-rule bg-surface px-2.5 py-1.5 text-[12.5px] mb-2" value={colaboradorId} onChange={(e) => setColaboradorId(e.target.value)}>
            <option value="">Elegir colaborador…</option>
            {team.filter((m) => m.id !== current?.id).map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          {error && <div className="text-red text-[11px] mb-1.5">{error}</div>}
          <div className="flex gap-2">
            <button type="button" className="flex-1 rounded border border-rule px-2.5 py-1.5 text-[11.5px] font-semibold cursor-pointer" onClick={() => { setOpen(null); setError(""); }}>Cancelar</button>
            <button type="button" disabled={saving || !colaboradorId} className="flex-1 rounded border border-teal bg-teal px-2.5 py-1.5 text-[11.5px] font-bold text-navy cursor-pointer disabled:opacity-40" onClick={() => assign(s.id, step, !!current)}>
              {saving ? "Asignando…" : current ? "Reasignar" : "Asignar"}
            </button>
          </div>
        </div>
      );
    }
    if (!canChange) return null;
    return current ? (
      <button type="button" className="mt-1 flex items-center gap-1.5 text-[11px] font-bold border border-rule text-steel rounded px-2 py-1 cursor-pointer hover:text-ink" onClick={() => openAssign(s.id, step)}>
        <RefreshCw size={12} /> Reasignar a otra persona
      </button>
    ) : (
      <button type="button" className="mt-1 flex items-center gap-1.5 text-[11.5px] font-bold border border-teal text-teal rounded px-2.5 py-1.5 cursor-pointer" onClick={() => openAssign(s.id, step)}>
        {step === "group" ? <Truck size={13} /> : <Package size={13} />} {step === "group" ? "Asignar quién agrupa" : "Asignar quién embala y entrega"}
      </button>
    );
  }

  if (sales === null) return <div className="text-[13px] text-steel">Cargando…</div>;
  if (sales.length === 0) return <div className="text-[13px] text-steel">No hay ventas por despachar.</div>;

  return (
    <div className="flex flex-col gap-2.5 max-w-lg">
      {sales.map((s) => {
        const grouped = !!s.prepReadyAt;
        const missing = !s.dispatchAssignedTo ? "Falta asignar quién agrupa" : !s.packAssignedTo ? "Falta asignar quién embala" : null;
        return (
          <div key={s.id} className="bg-surface border border-rule rounded-md p-3.5">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span className="font-mono text-[11px] font-bold text-teal">{s.code}</span>
              {s.code.startsWith("GL-") && <span className="font-mono text-[9.5px] font-bold uppercase rounded-full px-1.5 py-0.5 border border-gold/50 bg-gold/15">Garantía</span>}
              <span className="text-[11px] text-steel">{s.advisor?.name ?? "—"}</span>
              <span className="text-[10.5px] text-steel/70 ml-auto">{formatDateTime(s.reviewedAt ?? s.createdAt)}</span>
            </div>
            <SaleItems s={s} />
            {canAssignPack && (
              <GuidePrintLink saleId={s.id} printedAt={s.guidePrintedAt} printedByName={s.guidePrintedBy?.name ?? null} className="mb-2" />
            )}
            {missing && <div className="text-[11px] font-semibold text-gold mb-1">{missing}</div>}

            <div className="bg-cloud/50 rounded-md px-2.5">
              <StepRow n={1} title="Agrupar" done={!!s.dispatchAssignedTo}>
                <div className="text-[11.5px] text-steel">
                  {s.dispatchAssignedTo
                    ? <>Asignado a <span className="font-semibold text-ink">{s.dispatchAssignedTo.name}</span>{s.dispatchAssignedAt ? ` · ${formatDateTime(s.dispatchAssignedAt)}` : ""}</>
                    : "Sin asignar"}
                </div>
                {assignControl(s, "group", s.dispatchAssignedTo, canAssignGroup && !grouped)}
              </StepRow>

              <StepRow n={2} title="Preparado (foto de los productos)" done={grouped}>
                {grouped ? (
                  <div className="flex items-center gap-2">
                    {s.prepPhotoUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img loading="lazy" decoding="async" src={s.prepPhotoUrl} alt="Foto de los productos agrupados" className="w-10 h-10 object-cover rounded border border-rule" />
                    )}
                    <div className="text-[11.5px] text-green flex items-center gap-1">
                      <CheckCircle2 size={12} /> Listo{s.prepReadyBy ? ` por ${s.prepReadyBy.name}` : ""} · {formatDateTime(s.prepReadyAt!)}
                    </div>
                  </div>
                ) : (
                  <div className="text-[11.5px] text-steel">
                    {s.dispatchAssignedTo ? `Esperando que ${s.dispatchAssignedTo.name} agrupe y tome la foto.` : "Primero asigna quién agrupa."}
                  </div>
                )}
                {/* Si al líder le tocó agrupar a él mismo, lo marca acá sin cambiar de pestaña. */}
                {!grouped && s.dispatchAssignedTo?.id === meId && (
                  preparing === s.id ? (
                    <div className="bg-cloud rounded-md p-2.5 mt-1.5">
                      {photoUrl ? (
                        <div className="flex items-center gap-2 mb-2">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img loading="lazy" decoding="async" src={photoUrl} alt="Foto de los productos" className="w-16 h-16 object-cover rounded border border-rule" />
                          <button type="button" className="text-[11px] text-blue font-semibold cursor-pointer" onClick={() => { setPhotoUrl(null); setTaking(true); }}>Volver a tomar</button>
                        </div>
                      ) : taking ? (
                        <LiveCameraCapture folder="external-sale-prep-photos" onCaptured={(url) => { setPhotoUrl(url); setTaking(false); }} onCancel={() => setTaking(false)} />
                      ) : (
                        <button type="button" className="flex items-center gap-1.5 text-[12px] font-bold border-[1.5px] border-rule rounded-md px-3 py-1.5 cursor-pointer mb-2" onClick={() => setTaking(true)}>
                          <Camera size={13} /> Tomar foto de los productos
                        </button>
                      )}
                      {error && <div className="text-red text-[11px] mb-1.5">{error}</div>}
                      <div className="flex gap-2">
                        <button type="button" className="flex-1 rounded border border-rule px-2.5 py-1.5 text-[11.5px] font-semibold cursor-pointer" onClick={() => { setPreparing(null); setPhotoUrl(null); setTaking(false); }}>Cancelar</button>
                        <button type="button" disabled={saving || !photoUrl} className="flex-1 rounded border border-teal bg-teal px-2.5 py-1.5 text-[11.5px] font-bold text-navy cursor-pointer disabled:opacity-40" onClick={() => markReady(s.id)}>
                          {saving ? "Guardando…" : "Marcar listo"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" className="mt-1 flex items-center gap-1.5 text-[11.5px] font-bold border border-teal text-teal rounded px-2.5 py-1.5 cursor-pointer" onClick={() => { setPreparing(s.id); setPhotoUrl(null); setError(""); }}>
                      <Check size={13} /> Marcar listo para embalar
                    </button>
                  )
                )}
              </StepRow>

              <StepRow n={3} title="Embalar y entregar" done={false}>
                <div className="text-[11.5px] text-steel">
                  {s.packAssignedTo
                    ? <>Asignado a <span className="font-semibold text-ink">{s.packAssignedTo.name}</span>{s.packAssignedAt ? ` · ${formatDateTime(s.packAssignedAt)}` : ""}</>
                    : "Sin asignar"}
                </div>
                {s.packAssignedTo && !grouped && (
                  <div className="text-[10.5px] text-steel/80">Le llega el aviso y lo ve en &quot;Mis entregas&quot; cuando ya esté agrupado.</div>
                )}
                {assignControl(s, "pack", s.packAssignedTo, canAssignPack)}
              </StepRow>
            </div>
          </div>
        );
      })}
    </div>
  );
}
