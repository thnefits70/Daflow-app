"use client";

import { useEffect, useState } from "react";
import { uploadFile } from "@/lib/uploadFile";
import { formatDateTime } from "@/lib/formatDateTime";
import { ProofPreview } from "@/components/shared/ProofPreview";
import { UploadBox } from "@/components/pettycash/PettyCashPanel";
import { ReportReturnForm } from "./ReportReturnForm";

type Item = { id: string; declaredProductName: string; quantity: number; catalogItem: { name: string } | null };
type Eligible = {
  id: string; code: string; pickupPersonName: string; freightCost: number | null; isContraEntrega: boolean; deliveredAt: string;
  client: { name: string } | null; items: Item[];
};
type ReturnRow = {
  id: string; code: string; pickupPersonName: string; returnReason: string | null; returnedAt: string; returnReceivedAt: string | null;
  returnConfirmedAt?: string | null; returnFreightCost: number | null; freightPaidAt: string | null; freightPaidBy: { name: string } | null;
  client: { name: string } | null; items: Item[]; freightPettyCashEntries: { proofUrl: string | null }[];
  advisor?: { name: string } | null; isMine?: boolean;
};
type Board = { isAdvisor: boolean; payBoxes: ("PRINCIPAL" | "SECUNDARIA")[]; canSeeFreights: boolean; eligible: Eligible[]; myReturns: ReturnRow[]; freights: ReturnRow[] };

const BOX_LABEL = { PRINCIPAL: "Caja Chica Principal", SECUNDARIA: "Caja Chica Secundaria" } as const;

function itemsText(items: Item[]) {
  return items.map((it) => `${it.catalogItem?.name ?? it.declaredProductName} × ${it.quantity}`).join(", ");
}

function money(n: number | null) {
  return `$${(n ?? 0).toFixed(2)}`;
}

// Pedido de Marcos 2026-10-16 (aprobado por el usuario): pestaña
// "Devoluciones" — el asesor registra la "devolución de venta externa" de
// un pedido que salió de bodega y no llegó al cliente; el flete del
// motorizado lo paga Nairoby o Jariel desde su Caja Chica, con comprobante,
// recién cuando Inventario confirma que el paquete volvió.
export function ExternalSaleReturnsTab() {
  const [board, setBoard] = useState<Board | null>(null);
  const [loadErr, setLoadErr] = useState("");

  function load() {
    fetch("/api/external-sales/returns-board")
      .then(async (r) => {
        const data = await r.json().catch(() => null);
        if (!r.ok) throw new Error(data?.error ?? "No se pudo cargar.");
        setBoard(data);
      })
      .catch((e) => setLoadErr(e instanceof Error ? e.message : "No se pudo cargar."));
  }
  useEffect(load, []);

  if (loadErr) return <div className="text-[13px] text-red mb-4">{loadErr}</div>;
  if (!board) return <div className="text-[13px] text-steel mb-4">Cargando…</div>;

  const toPay = board.freights.filter((f) => !f.freightPaidAt && f.returnReceivedAt);
  const onTheWay = board.freights.filter((f) => !f.freightPaidAt && !f.returnReceivedAt);
  const paid = board.freights.filter((f) => f.freightPaidAt);

  return (
    <div className="flex flex-col gap-6 mb-6 max-w-2xl">
      {board.isAdvisor && (
        <section>
          <h2 className="font-display text-[15px] font-bold mb-1">Registrar devolución de venta externa</h2>
          <p className="text-[12px] text-steel mb-2.5">Pedidos que ya salieron de bodega y todavía no confirmas que el cliente recibió. Si no se entregó, regístralo aquí.</p>
          {board.eligible.length === 0 ? (
            <div className="text-[12.5px] text-steel">No tienes pedidos en camino.</div>
          ) : (
            <div className="flex flex-col gap-2">
              {board.eligible.map((s) => (
                <div key={s.id} className="bg-surface border border-rule rounded-md p-3">
                  <div className="text-[12px] font-semibold">{s.code} · {s.client?.name ?? "—"}</div>
                  <div className="text-[11.5px] text-steel">{itemsText(s.items)}</div>
                  <div className="text-[11px] text-steel">Motorizado: {s.pickupPersonName} · salió {formatDateTime(s.deliveredAt)}</div>
                  <ReportReturnForm saleId={s.id} declaredFreight={s.freightCost} isContraEntrega={s.isContraEntrega} onDone={load} buttonLabel="Registrar devolución de venta externa" />
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {board.isAdvisor && board.myReturns.length > 0 && (
        <section>
          <h2 className="font-display text-[15px] font-bold mb-2">Mis devoluciones</h2>
          <div className="flex flex-col gap-2">
            {board.myReturns.map((r) => (
              <div key={r.id} className="bg-surface border border-rule rounded-md p-3">
                <div className="text-[12px] font-semibold">{r.code} · {r.client?.name ?? "—"}</div>
                <div className="text-[11.5px] text-steel">{itemsText(r.items)}</div>
                <div className="text-[11px] text-steel mb-1.5">Motivo: {r.returnReason}</div>
                <ReturnSteps row={r} />
                {!r.freightPaidAt && <EditReturnFreight row={r} onDone={load} />}
              </div>
            ))}
          </div>
        </section>
      )}

      {board.canSeeFreights && (
        <section>
          <h2 className="font-display text-[15px] font-bold mb-1">Fletes de devoluciones</h2>
          <p className="text-[12px] text-steel mb-2.5">Lo que se le debe al motorizado por cada devolución. Se paga desde tu Caja Chica con comprobante cuando el paquete ya volvió a bodega.</p>
          {toPay.length === 0 && onTheWay.length === 0 && paid.length === 0 && <div className="text-[12.5px] text-steel">No hay fletes de devoluciones.</div>}
          <div className="flex flex-col gap-2">
            {toPay.map((f) => (
              <PayFreightCard key={f.id} row={f} payBoxes={board.payBoxes} onDone={load} />
            ))}
            {onTheWay.map((f) => (
              <div key={f.id} className="bg-surface border border-rule rounded-md p-3">
                <div className="text-[12px] font-semibold">{f.code} · {f.pickupPersonName} · {money(f.returnFreightCost)}</div>
                <div className="text-[11.5px] text-steel">{itemsText(f.items)} · vendió {f.advisor?.name ?? "—"}</div>
                <div className="text-[11px] text-gold mt-1">Esperando que el paquete vuelva a bodega — todavía no se puede pagar.</div>
              </div>
            ))}
            {paid.map((f) => (
              <div key={f.id} className="bg-surface border border-rule rounded-md p-3 opacity-80">
                <div className="text-[12px] font-semibold">{f.code} · {f.pickupPersonName} · {money(f.returnFreightCost)}</div>
                <div className="text-[11px] text-green mt-0.5">Pagado por {f.freightPaidBy?.name ?? "el administrador"} · {formatDateTime(f.freightPaidAt!)}</div>
                {f.freightPettyCashEntries[0]?.proofUrl && <div className="mt-1.5"><ProofPreview url={f.freightPettyCashEntries[0].proofUrl} size={48} /></div>}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ReturnSteps({ row }: { row: ReturnRow }) {
  const steps: { done: boolean; text: string }[] = [
    { done: true, text: `Devolución registrada · ${formatDateTime(row.returnedAt)}` },
    { done: !!row.returnReceivedAt, text: row.returnReceivedAt ? `Volvió a bodega · ${formatDateTime(row.returnReceivedAt)}` : "Esperando que vuelva a bodega" },
    { done: !!row.returnConfirmedAt, text: row.returnConfirmedAt ? "Daniel la sumó de nuevo al stock" : "Falta que Daniel la sume al stock" },
  ];
  if ((row.returnFreightCost ?? 0) > 0) {
    steps.push({
      done: !!row.freightPaidAt,
      text: row.freightPaidAt
        ? `Flete ${money(row.returnFreightCost)} pagado a ${row.pickupPersonName} por ${row.freightPaidBy?.name ?? "el administrador"}`
        : `Flete ${money(row.returnFreightCost)} a ${row.pickupPersonName}: ${row.returnReceivedAt ? "por pagar (Nairoby o Jariel)" : "se paga cuando vuelva a bodega"}`,
    });
  }
  return (
    <div className="flex flex-col gap-0.5">
      {steps.map((s, i) => (
        <div key={i} className={`text-[11px] ${s.done ? "text-green" : "text-steel"}`}>{s.done ? "✓" : "○"} {s.text}</div>
      ))}
      {row.freightPettyCashEntries[0]?.proofUrl && <div className="mt-1"><ProofPreview url={row.freightPettyCashEntries[0].proofUrl} size={44} /></div>}
    </div>
  );
}

function EditReturnFreight({ row, onDone }: { row: ReturnRow; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(row.returnFreightCost ? row.returnFreightCost.toFixed(2) : "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const num = value.trim() === "" ? 0 : Number(value);
  const valid = Number.isFinite(num) && num >= 0 && num <= 1000;

  async function save() {
    setSaving(true);
    setErr("");
    try {
      const res = await fetch(`/api/external-sales/${row.id}/return-freight`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnFreightCost: num }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "No se pudo guardar.");
      setOpen(false);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="text-[11px] font-semibold text-blue underline mt-1.5 cursor-pointer" onClick={() => setOpen(true)}>
        {(row.returnFreightCost ?? 0) > 0 ? "Corregir flete del motorizado" : "Agregar flete del motorizado"}
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
      <span className="text-[12px] text-steel">$</span>
      <input
        type="number"
        inputMode="decimal"
        min={0}
        step="0.01"
        className="w-24 rounded border border-rule bg-surface px-2 py-1 text-[12px]"
        placeholder="0.00"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button type="button" disabled={!valid || saving} className="rounded border border-teal bg-teal px-2.5 py-1 text-[11px] font-bold text-navy cursor-pointer disabled:opacity-40" onClick={save}>
        {saving ? "Guardando…" : "Guardar"}
      </button>
      <button type="button" className="text-steel text-[11px] cursor-pointer" onClick={() => setOpen(false)}>Cancelar</button>
      {err && <div className="text-red text-[11px] w-full">{err}</div>}
    </div>
  );
}

function PayFreightCard({ row, payBoxes, onDone }: { row: ReturnRow; payBoxes: ("PRINCIPAL" | "SECUNDARIA")[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<"PRINCIPAL" | "SECUNDARIA" | null>(payBoxes.length === 1 ? payBoxes[0] : null);
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const amount = row.returnFreightCost ?? 0;

  async function onFile(file: File) {
    setUploading(true);
    setErr("");
    const res = await uploadFile(file, "petty-cash");
    setUploading(false);
    if (!res.ok) { setErr(res.error); return; }
    setProofUrl(res.url);
  }

  async function pay() {
    if (!box || !proofUrl) return;
    setSaving(true);
    setErr("");
    try {
      const res = await fetch("/api/petty-cash/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          boxType: box,
          amount,
          description: `Flete devolución ${row.code} — ${row.pickupPersonName}`,
          proofUrl,
          linkedExternalSaleId: row.id,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "No se pudo registrar el pago.");
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo registrar el pago.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-surface border border-teal/50 rounded-md p-3">
      <div className="text-[12px] font-semibold">{row.code} · {row.pickupPersonName} · <span className="text-teal">{money(amount)}</span></div>
      <div className="text-[11.5px] text-steel">{itemsText(row.items)} · vendió {row.advisor?.name ?? "—"}</div>
      <div className="text-[11px] text-steel">Motivo: {row.returnReason}</div>
      <div className="text-[11px] text-blue mt-0.5">Volvió a bodega · {formatDateTime(row.returnReceivedAt!)}</div>

      {row.isMine ? (
        <div className="text-[11px] text-gold mt-1.5">Tú hiciste esta venta: el flete lo paga otra persona.</div>
      ) : payBoxes.length === 0 ? (
        <div className="text-[11px] text-gold mt-1.5">Por pagar — lo paga Nairoby o Jariel.</div>
      ) : !open ? (
        <button type="button" className="mt-2 rounded border border-teal bg-teal px-3 py-1.5 text-[11.5px] font-bold text-navy cursor-pointer" onClick={() => setOpen(true)}>
          Pagar flete al motorizado
        </button>
      ) : (
        <div className="bg-cloud rounded-md p-2.5 mt-2 flex flex-col gap-2">
          {payBoxes.length > 1 && (
            <div className="flex gap-2">
              {payBoxes.map((b) => (
                <button
                  key={b}
                  type="button"
                  className={`flex-1 rounded border px-2.5 py-1.5 text-[11.5px] font-semibold cursor-pointer ${box === b ? "border-teal bg-teal text-navy" : "border-rule bg-surface"}`}
                  onClick={() => setBox(b)}
                >
                  {BOX_LABEL[b]}
                </button>
              ))}
            </div>
          )}
          {box && <div className="text-[11.5px]">Sale de tu <b>{BOX_LABEL[box]}</b>: {money(amount)}</div>}
          {proofUrl ? (
            <div className="flex items-center gap-2">
              <ProofPreview url={proofUrl} size={56} />
              <button type="button" className="text-[11px] text-steel underline cursor-pointer" onClick={() => setProofUrl(null)}>Cambiar comprobante</button>
            </div>
          ) : uploading ? (
            <div className="text-[11.5px] text-steel">Subiendo…</div>
          ) : (
            <UploadBox label="📎 Comprobante del pago al motorizado" folder="petty-cash" onFile={onFile} onCaptured={(url) => setProofUrl(url)} />
          )}
          {err && <div className="text-red text-[11px]">{err}</div>}
          <div className="flex gap-2">
            <button type="button" className="flex-1 rounded border border-rule px-2.5 py-1.5 text-[11.5px] font-semibold cursor-pointer" onClick={() => { setOpen(false); setErr(""); }}>
              Cancelar
            </button>
            <button
              type="button"
              disabled={!box || !proofUrl || saving}
              className="flex-1 rounded border border-teal bg-teal px-2.5 py-1.5 text-[11.5px] font-bold text-navy cursor-pointer disabled:opacity-40"
              onClick={pay}
            >
              {saving ? "Revisando comprobante…" : "Registrar pago"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
