"use client";

import { useEffect, useState } from "react";
import { Camera, ClipboardCheck, CheckCircle2, Search } from "lucide-react";
import { actorName } from "@/lib/actorName";
import { TabGuide } from "@/components/shared/TabGuide";
import { formatDateTime } from "@/lib/formatDateTime";
import { CatalogCode } from "@/components/shared/CatalogCode";

type Row = {
  id: string;
  quantity: number;
  catalogItem: { name: string; photos: string[]; justCode: string | null };
  receipt: { photoUrls: string[]; receivedQuantity: number; confirmedAt: string } | null;
  marketingFollowUp: {
    designConfirmedAt: string | null;
    designConfirmedBy: { name: string } | null;
    advisorConfirmedAt: string | null;
    advisorConfirmedBy: { name: string; marketingAdvisorBrand: string | null } | null;
  } | null;
};

type Confirmer = { id: string; name: string; role: "design" | "advisor" };

function PhotoRow({ label, urls }: { label: string; urls: string[] }) {
  if (urls.length === 0) return null;
  return (
    <div className="flex-1 min-w-[180px] p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-steel mb-1.5">{label}</div>
      <div className="flex gap-2 flex-wrap">
        {urls.map((u, i) => (
          <div key={i} className="bg-cloud rounded border border-rule flex items-center justify-center w-36 h-36 shrink-0">
            <img src={u} alt="" className="max-w-full max-h-full object-contain" />
          </div>
        ))}
      </div>
    </div>
  );
}

// Confirmado 2026-08-08: pedido explícito del usuario — un botón que, al
// tocarlo, pide "¿estás seguro que se hizo todo el proceso?" antes de
// confirmar de verdad, para que nadie confirme por confirmar. Un solo
// componente reutilizado por diseño y por asesor.
function ConfirmButton({ label, icon, onConfirm, busy }: { label: string; icon: React.ReactNode; onConfirm: () => void; busy: boolean }) {
  const [asking, setAsking] = useState(false);
  if (asking) {
    return (
      <div className="flex-1 flex items-center gap-2 bg-gold/10 border border-gold/35 rounded px-2.5 py-2">
        <span className="flex-1 text-[11.5px]" style={{ color: "#D9A441" }}>¿Seguro que ya hiciste todo?</span>
        <button type="button" disabled={busy} className="text-[11.5px] font-bold text-teal cursor-pointer disabled:opacity-60" onClick={onConfirm}>Sí</button>
        <button type="button" className="text-[11.5px] text-steel cursor-pointer" onClick={() => setAsking(false)}>No</button>
      </div>
    );
  }
  return (
    <button
      type="button"
      className="flex-1 flex items-center justify-center gap-1.5 rounded border border-blue bg-blue px-3 py-2 text-[12px] font-semibold text-white cursor-pointer"
      onClick={() => setAsking(true)}
    >
      {icon} {label}
    </button>
  );
}

// Confirmado 2026-08-18: pedido explícito del usuario — filtrar por
// persona muestra solo lo que ESA persona (por su rol: diseño o asesoría)
// todavía no ha confirmado, ordenado de lo más antiguo a lo más nuevo para
// priorizar. Sin filtro (Todos), el orden por defecto sigue siendo lo más
// reciente arriba.
export function MarketingArrivalsPanel({ canConfirmDesign, canConfirmAdvisor }: { canConfirmDesign: boolean; canConfirmAdvisor: boolean }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [confirmers, setConfirmers] = useState<Confirmer[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  function load() {
    fetch("/api/marketing-arrivals")
      .then((r) => (r.ok ? r.json() : { rows: [], confirmers: [] }))
      .then((data) => {
        setRows(data.rows ?? []);
        setConfirmers(data.confirmers ?? []);
      })
      .catch(() => {
        setRows([]);
        setConfirmers([]);
      });
  }
  useEffect(load, []);

  async function confirm(kind: "design" | "advisor", requestId: string) {
    setBusyId(requestId);
    await fetch(`/api/marketing-arrivals/${requestId}/confirm-${kind}`, { method: "POST" }).catch(() => null);
    setBusyId(null);
    load();
  }

  if (!rows) return <div className="text-steel text-[13px]">Cargando…</div>;
  if (rows.length === 0) {
    return <div className="border-[1.5px] border-dashed border-rule rounded-md p-8 text-center text-steel text-[13.5px]">Todavía no ha llegado nada a bodega.</div>;
  }

  const selected = filter === "all" ? null : confirmers.find((c) => `${c.role}:${c.id}` === filter) ?? null;
  const pendingKey = (r: Row, role: "design" | "advisor") =>
    role === "design" ? r.marketingFollowUp?.designConfirmedAt : r.marketingFollowUp?.advisorConfirmedAt;

  const visibleRows = selected
    ? rows
        .filter((r) => !pendingKey(r, selected.role))
        .sort((a, b) => {
          const ta = a.receipt?.confirmedAt ? new Date(a.receipt.confirmedAt).getTime() : 0;
          const tb = b.receipt?.confirmedAt ? new Date(b.receipt.confirmedAt).getTime() : 0;
          return ta - tb; // más antiguo primero
        })
    : rows; // orden por defecto de la API: más reciente primero

  const query = search.trim().toLowerCase();
  const searchedRows = query
    ? visibleRows.filter(
        (r) => r.catalogItem.name.toLowerCase().includes(query) || r.catalogItem.justCode?.toLowerCase().includes(query)
      )
    : visibleRows;

  return (
    <div className="flex flex-col gap-3">
      <TabGuide storageKey="mercaderia-recibida">
        {canConfirmDesign || canConfirmAdvisor ? (
          <>Acá aparece cada producto nuevo que llegó a bodega. Confirma tu parte (diseño o asesor, según te toque) cuando ya la hiciste — el filtro de arriba te muestra solo lo que tienes pendiente.</>
        ) : (
          <>Vista de solo lectura de la mercadería nueva que va llegando y en qué paso va: confirmación de diseño y confirmación de asesor.</>
        )}
      </TabGuide>
      <div className="relative" style={{ maxWidth: 320 }}>
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-steel" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nombre o ID..."
          className="w-full rounded border border-rule bg-surface pl-8 pr-2.5 py-1.5 text-[12.5px]"
        />
      </div>
      {confirmers.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setFilter("all")}
            className={`rounded-full border px-3 py-1 text-[11.5px] font-semibold cursor-pointer transition-colors ${
              filter === "all" ? "border-blue bg-blue text-white" : "border-rule text-steel hover:border-blue/50"
            }`}
          >
            Todos
          </button>
          {confirmers.map((c) => {
            const key = `${c.role}:${c.id}`;
            const pendingCount = rows.filter((r) => !pendingKey(r, c.role)).length;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`rounded-full border px-3 py-1 text-[11.5px] font-semibold cursor-pointer transition-colors ${
                  filter === key ? "border-blue bg-blue text-white" : "border-rule text-steel hover:border-blue/50"
                }`}
              >
                {c.name}
                {pendingCount > 0 && (
                  <span className={`ml-1.5 ${filter === key ? "text-white/80" : "text-steel"}`}>({pendingCount})</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {selected && visibleRows.length === 0 && (
        <div className="border-[1.5px] border-dashed border-rule rounded-md p-8 text-center text-steel text-[13.5px]">
          {selected.name} ya confirmó todo lo que tenía pendiente.
        </div>
      )}

      {visibleRows.length > 0 && searchedRows.length === 0 && (
        <div className="border-[1.5px] border-dashed border-rule rounded-md p-8 text-center text-steel text-[13.5px]">
          No se encontró ningún producto con &quot;{search.trim()}&quot;.
        </div>
      )}

      {searchedRows.map((r) => {
        const fu = r.marketingFollowUp;
        return (
          <div key={r.id} className="bg-surface border border-rule rounded-md p-4">
            <div className="text-[14.5px] font-bold mb-0.5 flex items-center gap-1.5">
              <CatalogCode code={r.catalogItem.justCode} size="text-[11px]" />
              <span>{r.catalogItem.name}</span>
            </div>
            <div className="text-[12px] text-steel mb-3">
              {r.receipt?.receivedQuantity ?? r.quantity} un. recibidas{r.receipt ? ` · ${new Date(r.receipt.confirmedAt).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}` : ""}
            </div>

            <div className="flex flex-wrap divide-x divide-rule border border-rule rounded-md overflow-hidden mb-3.5">
              <PhotoRow label="Referencia — como se registró el producto" urls={r.catalogItem.photos} />
              <PhotoRow label="Llegó así — foto real de esta recepción" urls={r.receipt?.photoUrls ?? []} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-rule">
              <div>
                <div className="text-[11px] font-semibold text-ink mb-0.5">Diseño de marca</div>
                <div className="text-[10.5px] text-steel mb-2">Fotos reales brandeadas + video publicitario en el catálogo de Drive.</div>
                {fu?.designConfirmedAt ? (
                  <div className="flex items-center gap-1.5 text-[12px] text-teal">
                    <CheckCircle2 size={14} /> Confirmado — {actorName(fu.designConfirmedBy?.name)} · {formatDateTime(fu.designConfirmedAt)}
                  </div>
                ) : canConfirmDesign ? (
                  <ConfirmButton label="Confirmar fotos y video subidos" icon={<Camera size={14} />} busy={busyId === r.id} onConfirm={() => confirm("design", r.id)} />
                ) : (
                  <div className="flex items-center gap-1.5 text-[12px] text-steel">
                    <Camera size={14} /> Todavía pendiente
                  </div>
                )}
              </div>

              <div>
                <div className="text-[11px] font-semibold text-ink mb-0.5">Asesor de marca</div>
                <div className="text-[10.5px] text-steel mb-2">Verificar stock, precio de venta, descripción y Dropi.</div>
                {fu?.advisorConfirmedAt ? (
                  <div className="flex items-center gap-1.5 text-[12px] text-teal">
                    <CheckCircle2 size={14} /> Confirmado — {actorName(fu.advisorConfirmedBy?.name)}{fu.advisorConfirmedBy?.marketingAdvisorBrand ? ` (${fu.advisorConfirmedBy.marketingAdvisorBrand})` : ""} · {formatDateTime(fu.advisorConfirmedAt)}
                  </div>
                ) : canConfirmAdvisor ? (
                  <ConfirmButton label="Confirmar stock, precio, descripción y Dropi" icon={<ClipboardCheck size={14} />} busy={busyId === r.id} onConfirm={() => confirm("advisor", r.id)} />
                ) : (
                  <div className="flex items-center gap-1.5 text-[12px] text-steel">
                    <ClipboardCheck size={14} /> Todavía pendiente
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
