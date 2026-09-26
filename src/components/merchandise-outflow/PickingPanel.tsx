"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Package, RefreshCw, ScanLine, UserRound } from "lucide-react";
import { LiveBarcodeScanner } from "@/components/shared/LiveBarcodeScanner";
import { CatalogCode } from "@/components/shared/CatalogCode";
import { carrierLabel, sortCarriers } from "@/lib/carriers";
import type { CompiledLot, LotPickLine } from "./LotView";
import { BlockAssignee } from "./BlockAssignee";

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit", timeZone: "America/Guayaquil" });
}

function Thumb({ url }: { url: string | undefined }) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" className="w-10 h-10 object-cover rounded border border-rule shrink-0" />
  ) : (
    <div className="w-10 h-10 rounded border border-dashed border-rule shrink-0 flex items-center justify-center text-steel">
      <Package size={14} />
    </div>
  );
}

type RowState = "confirmed" | "pending" | "match" | "mismatch";
function rowState(p: LotPickLine): RowState {
  if (p.confirmedAt) return "confirmed";
  if (p.picked === null) return "pending";
  return p.picked === p.needed ? "match" : "mismatch";
}
const ROW_STYLE: Record<RowState, string> = {
  confirmed: "bg-navy/5",
  pending: "bg-cloud",
  match: "bg-green/10 border border-green/35",
  mismatch: "bg-red/10 border border-red/35",
};

// Parte 3 del plan acordado con el usuario 2026-09-23: Joel y Scott escanean
// el QR de la percha UNA vez y escriben cuántos sacaron; Daniel compara lo
// pedido con lo sacado y confirma con doble clic — lo que cuadra de una
// vez, lo que no uno por uno. Recién ahí se descuenta del Kardex.
export function PickingPanel({ lot, onChanged }: { lot: CompiledLot; onChanged: () => void }) {
  const canConfirm = !!lot.viewer?.canConfirm && lot.status === "SENT";
  const [scanning, setScanning] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [current, setCurrent] = useState<LotPickLine | null>(null);
  const [qty, setQty] = useState("");
  const [notFound, setNotFound] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // Doble confirmación de Daniel: "all" = todo lo que cuadra; un id = ese producto.
  const [confirming, setConfirming] = useState<string | null>(null);
  // Bloques (pedido de Daniel 2026-09-26): cada uno ve primero lo suyo.
  const myId = lot.viewer?.userId ?? null;
  const myBlocks = lot.blocks.filter((b) => myId && b.assigneeId === myId).map((b) => b.carrier);
  // Fulfillment ("ASSIGNED") solo saca lo que Daniel le asignó; Inventario, todo.
  const onlyAssigned = lot.viewer?.pickScope === "ASSIGNED";
  const canPick = !!lot.viewer?.canPick && lot.status === "SENT" && (!onlyAssigned || myBlocks.length > 0);
  const [onlyMine, setOnlyMine] = useState(true);
  const showOnlyMine = onlyMine && myBlocks.length > 0 && !canConfirm;
  const blockInfo = (carrier: string) => lot.blocks.find((b) => b.carrier === carrier);

  const matching = lot.picking.filter((p) => rowState(p) === "match");
  const byCarrierOf = (id: string) => lot.lines.find((l) => l.catalogItemId === id)?.byCarrier ?? {};
  const pieces = lot.warranty.filter((w) => w.mode === "PIECE");

  function openCode(raw: string) {
    const code = raw.trim();
    setNotFound("");
    setErr("");
    const line = lot.picking.find((p) => p.justCode === code || p.catalogItemId === code);
    if (!line) {
      setCurrent(null);
      setNotFound(`El código ${code} no está en el manifiesto de este corte — no lo saques.`);
      return;
    }
    setCurrent(line);
    setQty(line.picked !== null ? String(line.picked) : "");
  }

  async function savePick() {
    if (!current) return;
    const n = Number(qty);
    if (!Number.isInteger(n) || n < 0) {
      setErr("Escribe cuántos sacaste (un número).");
      return;
    }
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/fulfillment-lots/${lot.id}/picks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ catalogItemId: current.catalogItemId, quantity: n }),
    });
    const json = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      setErr(json?.error ?? "No se pudo registrar.");
      return;
    }
    setCurrent(null);
    setQty("");
    setManualCode("");
    onChanged();
  }

  async function confirm(ids: string[], onlyMatching: boolean) {
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/fulfillment-lots/${lot.id}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ catalogItemIds: ids, onlyMatching }),
    });
    const json = await res.json().catch(() => null);
    setBusy(false);
    setConfirming(null);
    if (!res.ok) {
      setErr(json?.error ?? "No se pudo confirmar.");
      return;
    }
    onChanged();
  }

  async function confirmPiece(itemId: string) {
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/fulfillment-lots/${lot.id}/confirm-piece`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId }),
    });
    const json = await res.json().catch(() => null);
    setBusy(false);
    setConfirming(null);
    if (!res.ok) {
      setErr(json?.error ?? "No se pudo confirmar.");
      return;
    }
    onChanged();
  }

  const done = lot.picking.filter((p) => p.confirmedAt).length;
  const picked = lot.picking.filter((p) => p.picked !== null).length;

  return (
    <div className="border-t border-rule pt-3 mt-1">
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <span className="font-display font-bold text-[13.5px]">Sacar y confirmar</span>
        <span className="text-[11px] text-steel">
          {picked}/{lot.picking.length} registrados por el equipo · {done}/{lot.picking.length} confirmados por Daniel
        </span>
        {lot.status === "SENT" && (
          <button type="button" className="ml-auto flex items-center gap-1 text-[11px] text-steel hover:text-teal cursor-pointer" onClick={onChanged}>
            <RefreshCw size={11} /> Actualizar
          </button>
        )}
      </div>

      {lot.status === "CLOSED" && (
        <div className="flex items-center gap-1.5 text-teal text-[12px] font-semibold mb-2">
          <CheckCircle2 size={14} /> Corte cerrado{lot.closedAt ? ` a las ${fmtTime(lot.closedAt)}` : ""} — ya se descontó del Kardex lo que salió.
        </div>
      )}

      {myBlocks.length > 0 && !canConfirm && lot.status === "SENT" && (
        <div className="flex items-center gap-2 flex-wrap bg-teal/10 border border-teal/40 rounded-md px-3 py-2 mb-2 text-[12.5px]">
          <UserRound size={14} className="text-teal shrink-0" />
          <span>
            Daniel te asignó: <b>{myBlocks.map(carrierLabel).join(", ")}</b> ·{" "}
            {lot.picking.filter((p) => myBlocks.includes(p.block) && p.picked !== null).length}/{lot.picking.filter((p) => myBlocks.includes(p.block)).length} registrados
          </span>
          <label className="ml-auto flex items-center gap-1 text-[11.5px] text-steel cursor-pointer">
            <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} /> Ver solo lo mío
          </label>
        </div>
      )}

      {onlyAssigned && myBlocks.length === 0 && lot.status === "SENT" && (
        <div className="text-[12px] text-steel bg-cloud rounded-md px-3 py-2 mb-2">Daniel todavía no te asignó ningún bloque de este corte.</div>
      )}

      {canPick && (
        <div className="bg-cloud rounded-md p-3 mb-3">
          {scanning ? (
            <LiveBarcodeScanner
              onScanned={(code) => {
                setScanning(false);
                openCode(code);
              }}
              onCancel={() => setScanning(false)}
            />
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                className="flex items-center gap-1.5 rounded border border-teal bg-teal px-3.5 py-2 text-[13px] font-bold text-navy cursor-pointer"
                onClick={() => {
                  setCurrent(null);
                  setNotFound("");
                  setScanning(true);
                }}
              >
                <ScanLine size={15} /> Escanear QR de la percha
              </button>
              <span className="text-[11px] text-steel">¿No lee?</span>
              <input
                type="text"
                inputMode="numeric"
                placeholder="Escribe el ID"
                className="w-28 rounded border border-rule bg-surface px-2 py-1.5 text-[12px] font-mono"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && manualCode.trim() && openCode(manualCode)}
              />
              <button type="button" disabled={!manualCode.trim()} className="text-[12px] font-semibold text-teal cursor-pointer disabled:opacity-40" onClick={() => openCode(manualCode)}>
                Buscar
              </button>
            </div>
          )}

          {notFound && (
            <div className="mt-2 text-[12px] text-red flex items-start gap-1.5">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {notFound}
            </div>
          )}

          {current && (
            <div className="mt-3 bg-surface border border-teal/40 rounded-md p-3">
              <div className="flex items-center gap-2.5 mb-1.5">
                <Thumb url={current.photos[0]} />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <CatalogCode code={current.justCode} />
                  </div>
                  <div className="text-[13px] font-semibold">{current.name}</div>
                </div>
              </div>
              <div className="text-[12px] mb-0.5">
                Pedidos: <b className="font-mono">{current.needed}</b>
                {current.warrantyNeeded > 0 ? ` (incluye ${current.warrantyNeeded} de garantía)` : ""}
              </div>
              <div className="text-[11px] text-steel mb-2">
                {sortCarriers(Object.keys(byCarrierOf(current.catalogItemId)))
                  .map((c) => `${carrierLabel(c)} ${byCarrierOf(current.catalogItemId)[c]}`)
                  .join(" · ")}
              </div>
              {myBlocks.length > 0 && !myBlocks.includes(current.block) && (
                <div className="text-[11.5px] text-amber mb-1.5 flex items-start gap-1">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                  Este producto es del bloque {carrierLabel(current.block)}
                  {blockInfo(current.block)?.assigneeName ? `, le toca a ${blockInfo(current.block)?.assigneeName}` : ""}.{" "}
                  {onlyAssigned ? "No lo saques: no es de tu bloque." : "Puedes registrarlo igual si lo sacaste tú."}
                </div>
              )}
              {current.picked !== null && (
                <div className="text-[11px] text-steel mb-1.5">
                  Ya registrado: {current.picked}
                  {current.pickedByName ? ` por ${current.pickedByName}` : ""} — lo que escribas reemplaza ese número.
                </div>
              )}
              {current.confirmedAt ? (
                <div className="text-[12px] text-steel">Daniel ya confirmó este producto.</div>
              ) : onlyAssigned && !myBlocks.includes(current.block) ? (
                <button type="button" className="text-[12px] text-steel cursor-pointer" onClick={() => setCurrent(null)}>
                  Cerrar
                </button>
              ) : (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[12px]">¿Cuántos sacaste de la percha?</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    autoFocus
                    className="w-20 rounded border border-rule bg-surface px-2 py-1.5 text-[14px] font-mono font-bold"
                    value={qty}
                    onChange={(e) => setQty(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && savePick()}
                  />
                  <button type="button" disabled={busy || qty === ""} className="rounded border border-teal bg-teal px-3 py-1.5 text-[12.5px] font-bold text-navy cursor-pointer disabled:opacity-50" onClick={savePick}>
                    {busy ? "Guardando…" : "Registrar"}
                  </button>
                  <button type="button" className="text-[12px] text-steel cursor-pointer" onClick={() => setCurrent(null)}>
                    Cancelar
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {err && <div className="text-red text-[12px] mb-2">{err}</div>}

      {canConfirm && matching.length > 0 && (
        <div className="mb-2">
          {confirming === "all" ? (
            <div className="bg-cloud border border-teal/40 rounded-md p-3">
              <div className="text-[12.5px] font-bold mb-1">¿Confirmar los {matching.length} productos que cuadran?</div>
              <div className="text-[11.5px] mb-2">Se descontarán del Kardex de INVESTOCK. Esto no se puede deshacer.</div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  className="rounded border border-teal bg-teal px-3 py-1.5 text-[12px] font-bold text-navy cursor-pointer disabled:opacity-60"
                  onClick={() => confirm(matching.map((m) => m.catalogItemId), true)}
                >
                  {busy ? "Confirmando…" : "Sí, confirmar"}
                </button>
                <button type="button" className="rounded border border-rule px-3 py-1.5 text-[12px] font-semibold cursor-pointer" onClick={() => setConfirming(null)}>
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="flex items-center gap-1.5 rounded border border-green bg-green/15 px-3.5 py-2 text-[12.5px] font-bold cursor-pointer" onClick={() => setConfirming("all")}>
              <CheckCircle2 size={14} /> Confirmar todo lo que cuadra ({matching.length})
            </button>
          )}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        {lot.blocks
          .filter((b) => !showOnlyMine || myBlocks.includes(b.carrier))
          .map((b) => {
            const rows = lot.picking.filter((p) => p.block === b.carrier);
            const n = rows.length;
            const reg = rows.filter((p) => p.picked !== null || p.confirmedAt).length;
            const bad = rows.filter((p) => rowState(p) === "mismatch").length;
            const mine = !!myId && b.assigneeId === myId;
            return (
              <div key={b.carrier} className="flex flex-col gap-1.5">
                <div className={`flex items-center gap-2 flex-wrap mt-2 pb-1 border-b ${mine ? "border-teal" : "border-rule"}`}>
                  <span className="text-[11.5px] font-bold uppercase tracking-wider">
                    {lot.blocks.indexOf(b) + 1}° · Lleva {carrierLabel(b.carrier)}
                  </span>
                  <span className="text-[11px] text-steel">
                    {n} productos · {rows.reduce((s, p) => s + p.needed, 0)} u · {reg}/{n} registrados
                    {bad > 0 && <span className="text-red font-semibold"> · {bad} no cuadran</span>}
                  </span>
                  <BlockAssignee lot={lot} carrier={b.carrier} onChanged={onChanged} />
                </div>
        {rows.map((p) => {
          const st = rowState(p);
          const qtyToConfirm = Math.min(p.picked ?? 0, p.needed);
          return (
            <div key={p.catalogItemId} className={`rounded-md px-3 py-2 text-[12px] ${ROW_STYLE[st]}`}>
              <div className="flex items-center gap-2 flex-wrap">
                <CatalogCode code={p.justCode} />
                <span className="flex-1 min-w-0">{p.name}</span>
                <span className="font-mono text-[11.5px]">
                  pedido <b>{p.needed}</b> · sacado <b>{p.picked ?? "—"}</b>
                  {st === "confirmed" && (
                    <>
                      {" "}
                      · confirmado <b>{p.confirmedQty}</b>
                    </>
                  )}
                </span>
                {st === "confirmed" && <CheckCircle2 size={14} className="text-teal shrink-0" />}
              </div>
              {p.pickedByName && p.pickedAt && st !== "confirmed" && (
                <div className="text-[10.5px] text-steel mt-0.5">
                  Registró {p.pickedByName} a las {fmtTime(p.pickedAt)}
                </div>
              )}
              {st === "confirmed" && p.confirmedQty !== null && p.confirmedQty < p.needed && (
                <div className="text-[10.5px] text-red mt-0.5">Faltaron {p.needed - p.confirmedQty}</div>
              )}
              {canConfirm && (st === "mismatch" || st === "pending") && (
                <div className="mt-1.5">
                  {confirming === p.catalogItemId ? (
                    <div className="bg-surface border border-red/40 rounded-md p-2.5">
                      <div className="text-[12px] font-bold mb-1">
                        {qtyToConfirm === 0 ? "¿Confirmar que NO salió ninguno?" : `¿Confirmar que salieron ${qtyToConfirm}?`}
                      </div>
                      <div className="text-[11px] mb-2">
                        {(p.picked ?? 0) > p.needed
                          ? `Sacaron ${p.picked}, pero se pidieron ${p.needed}: se confirman ${p.needed} y los ${(p.picked ?? 0) - p.needed} de más vuelven a la percha.`
                          : `Se pidieron ${p.needed}: faltan ${p.needed - qtyToConfirm}. Se descuenta del Kardex solo lo que salió y se avisa a Yair y Bryan Ríos al cerrar el corte.`}
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          className="rounded border border-teal bg-teal px-3 py-1 text-[12px] font-bold text-navy cursor-pointer disabled:opacity-60"
                          onClick={() => confirm([p.catalogItemId], false)}
                        >
                          {busy ? "Confirmando…" : `Sí, confirmar ${qtyToConfirm}`}
                        </button>
                        <button type="button" className="rounded border border-rule px-3 py-1 text-[12px] font-semibold cursor-pointer" onClick={() => setConfirming(null)}>
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" className="text-[11.5px] font-semibold text-red cursor-pointer" onClick={() => setConfirming(p.catalogItemId)}>
                      {st === "pending" ? "Nadie lo registró — confirmar igual…" : "No cuadra — confirmar lo que salió…"}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
              </div>
            );
          })}
      </div>

      {pieces.length > 0 && (
        <div className="mt-3">
          <div className="text-[11px] font-semibold text-steel mb-1">Piezas de garantía (stock de repuestos, no se escanean)</div>
          <div className="flex flex-col gap-1.5">
            {pieces.map((w) => (
              <div key={w.itemId} className={`rounded-md px-3 py-2 text-[12px] ${w.pieceConfirmedAt ? "bg-navy/5" : "bg-cloud"}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="flex-1 min-w-0">
                    Pieza <b>{w.piece}</b> de {w.name} · guía {w.guide} · {carrierLabel(w.carrier)} × {w.quantity}
                  </span>
                  {w.pieceConfirmedAt && <CheckCircle2 size={14} className="text-teal shrink-0" />}
                </div>
                {canConfirm && !w.pieceConfirmedAt && (
                  <div className="mt-1.5">
                    {confirming === w.itemId ? (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11.5px] font-semibold">¿Confirmar que salió esta pieza?</span>
                        <button
                          type="button"
                          disabled={busy}
                          className="rounded border border-teal bg-teal px-3 py-1 text-[12px] font-bold text-navy cursor-pointer disabled:opacity-60"
                          onClick={() => confirmPiece(w.itemId)}
                        >
                          Sí, confirmar
                        </button>
                        <button type="button" className="text-[12px] text-steel cursor-pointer" onClick={() => setConfirming(null)}>
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <button type="button" className="text-[11.5px] font-semibold text-teal cursor-pointer" onClick={() => setConfirming(w.itemId)}>
                        Confirmar pieza entregada…
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
