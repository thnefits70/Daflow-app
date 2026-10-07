import { Fragment } from "react";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { canPrintFulfillmentManifest, canViewFulfillmentRequests, dbUserId } from "@/lib/guards";
import { getCompiledLot, manifestCode, markLotPrinted } from "@/lib/fulfillmentGuides";
import { areaGroupCount, carrierLabel, lineBlock, newAreaGroup, sortByBlock } from "@/lib/carriers";
import { areaLabel } from "@/lib/warehouseAreas";
import { brandLabel, sortBrands } from "@/lib/brandLabels";
import { PrintButton } from "./PrintButton";

function fmtDay(day: string) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("es-EC", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

function fmtTime(d: Date) {
  return d.toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit", timeZone: "America/Guayaquil" });
}

function warrantyText(mode: string, piece: string | null) {
  if (mode === "PIECE") return `Solo pieza: ${piece}`;
  if (mode === "PIECE_STOCK") return `Solo pieza: ${piece} (se descuenta el producto)`;
  const variant = piece ? ` (${piece})` : "";
  if (mode === "PARTIAL") return `Solo esta parte del combo${variant}`;
  return `Completo${variant}`;
}

// Confirmado 2026-09-23 (plan acordado con el usuario): la hoja que Daniel
// imprime y entrega a Joel y Scott — el nuevo manifiesto, registrado en
// DAFLOW con su número MF. Solo ID madre, nombre (con colores/tallas en una
// línea chica) y cuántos van a cada transportadora; ordenada para que
// primero salga lo de las transportadoras que menos veces recogen al día.
export default async function ManifestPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) redirect("/login");
  if (!(await canViewFulfillmentRequests())) notFound();

  const { id } = await params;
  let lot = await getCompiledLot(id);
  if (!lot) notFound();

  // Abrir esta hoja directo (sin pasar por el botón) también deja registrado
  // quién la imprimió y asegura el MF de cortes enviados antes del
  // 2026-09-26, cuando el número todavía se daba al imprimir.
  if (!lot.printedAt && lot.status !== "DRAFT" && (await canPrintFulfillmentManifest())) {
    const marked = await markLotPrinted(id, dbUserId(session.user.id));
    if (marked.ok) lot = (await getCompiledLot(id)) ?? lot;
  }

  if (!lot.manifestNumber) {
    return (
      <div className="min-h-screen bg-white text-black p-10 text-center text-[14px]">
        Este corte todavía no tiene manifiesto. Imprímelo desde la pestaña Solicitud Fulfillment.
      </div>
    );
  }

  // Primero lo que va a la transportadora de mayor prioridad; dentro de
  // cada grupo, de mayor a menor cantidad. Pedido de Daniel (2026-09-26): un
  // título donde empieza cada grupo, con a quién se lo asignó.
  const lines = sortByBlock(lot.lines);
  const groupTitle = (carrier: string) => {
    const b = lot.blocks.find((x) => x.carrier === carrier);
    const n = [...new Set(lines.map((l) => lineBlock(l.byCarrier)))].indexOf(carrier) + 1;
    // 2026-10-07: también quién hizo la asignación (Daniel o Allan).
    const by = b?.assigneeName && b.assignedByName ? ` (asignado por ${b.assignedByName})` : "";
    return `${n}° · Lleva ${carrierLabel(carrier)}${b?.assigneeName ? ` · Saca: ${b.assigneeName}${by}` : ""}`;
  };
  const totals = lot.carriers.map((c) => lines.reduce((s, l) => s + (l.byCarrier[c] ?? 0), 0));
  const units = lines.reduce((s, l) => s + l.quantity, 0);

  return (
    <div className="min-h-screen bg-white text-black py-8 px-6 print:p-0">
      <PrintButton />
      {/* Después de imprimir, volver al corte para escanear y confirmar lo que sale. */}
      <a
        href="/area/workspace?tab=egresos&otab=solicitud"
        className="print:hidden fixed top-4 left-4 text-[13px] font-bold bg-white text-black border border-black/30 rounded-md px-4 py-2 shadow"
      >
        ← Ir al corte para despachar
      </a>
      <div className="max-w-4xl mx-auto">
        <div className="flex items-start justify-between border-b-2 border-black pb-3 mb-4">
          <div>
            <div className="text-[11px] tracking-[0.2em] font-bold text-gray-500 uppercase">DAFLOW · Manifiesto de despacho</div>
            <div className="text-[26px] font-bold leading-tight">{manifestCode(lot.manifestNumber)}</div>
            <div className="text-[13px] capitalize">
              Corte {lot.corte} · {fmtDay(lot.day)}
            </div>
          </div>
          <div className="text-right text-[11.5px] text-gray-700">
            {lot.sentAt && (
              <div>
                Enviado por {lot.sentByName} · {fmtTime(lot.sentAt)}
              </div>
            )}
            {lot.printedAt && (
              <div>
                Impreso por {lot.printedByName} · {fmtTime(lot.printedAt)}
              </div>
            )}
            <div className="font-semibold mt-1">
              {lines.length} productos · {units} unidades
              {lot.warranty.length > 0 ? ` · ${lot.warranty.length} garantía(s)` : ""}
              {lot.provisional.length > 0 ? ` · ${lot.provisional.length} con ID provisional` : ""}
            </div>
          </div>
        </div>

        {lines.length > 0 && (
          <table className="w-full text-[12px] border-collapse mb-6">
            <thead>
              <tr className="border-b-2 border-black text-left">
                <th className="py-1.5 pr-2">ID</th>
                <th className="py-1.5 pr-2">Producto</th>
                {lot.carriers.map((c) => (
                  <th key={c} className="py-1.5 px-1.5 text-right whitespace-nowrap">
                    {carrierLabel(c)}
                  </th>
                ))}
                <th className="py-1.5 px-1.5 text-right">Total</th>
                <th className="py-1.5 pl-2 text-center">Sacado</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <Fragment key={l.catalogItemId}>
                  {(i === 0 || lineBlock(lines[i - 1].byCarrier) !== lineBlock(l.byCarrier)) && (
                    <tr style={{ breakAfter: "avoid" }}>
                      <td colSpan={lot.carriers.length + 4} className="pt-3 pb-1 text-[11px] font-bold uppercase tracking-wider border-b border-black">
                        {groupTitle(lineBlock(l.byCarrier))}
                      </td>
                    </tr>
                  )}
                  {newAreaGroup(lines, i) && (
                    <tr style={{ breakAfter: "avoid" }}>
                      <td colSpan={lot.carriers.length + 4} className="pt-2 pb-0.5 text-[11px] font-bold">
                        ▸ {areaLabel(l.area)} · {areaGroupCount(lines, i)} productos
                      </td>
                    </tr>
                  )}
                <tr className="border-b border-gray-300 align-top" style={{ breakInside: "avoid" }}>
                  <td className="py-1.5 pr-2 font-mono font-bold whitespace-nowrap">{l.justCode ?? "—"}</td>
                  <td className="py-1.5 pr-2">
                    <div className="font-semibold">{l.name}</div>
                    {l.variants.length > 0 && <div className="text-[10.5px] text-gray-600">{l.variants.map((v) => `${v.label} ${v.quantity}`).join(" · ")}</div>}
                  </td>
                  {lot.carriers.map((c) => (
                    <td key={c} className="py-1.5 px-1.5 text-right font-mono">
                      {l.byCarrier[c] ?? "–"}
                    </td>
                  ))}
                  <td className="py-1.5 px-1.5 text-right font-mono font-bold">{l.quantity}</td>
                  <td className="py-1.5 pl-2">
                    <div className="w-12 h-5 border border-gray-500 mx-auto" />
                  </td>
                </tr>
                </Fragment>
              ))}
              <tr className="border-t-2 border-black font-bold">
                <td className="py-1.5 pr-2" colSpan={2}>
                  Total por transportadora
                </td>
                {totals.map((t, i) => (
                  <td key={lot.carriers[i]} className="py-1.5 px-1.5 text-right font-mono">
                    {t}
                  </td>
                ))}
                <td className="py-1.5 px-1.5 text-right font-mono">{units}</td>
                <td />
              </tr>
              <tr className="font-bold">
                <td className="py-1.5 pr-2" colSpan={2}>
                  Guías por transportadora
                </td>
                {lot.carriers.map((c) => (
                  <td key={c} className="py-1.5 px-1.5 text-right font-mono">
                    {lot.guidesByCarrier[c] ?? 0}
                  </td>
                ))}
                <td className="py-1.5 px-1.5 text-right font-mono">{Object.values(lot.guidesByCarrier).reduce((s, n) => s + n, 0)}</td>
                <td />
              </tr>
              {/* Pedido del usuario 2026-09-28: igual que en la app, cuántas
                  guías trae el manifiesto de cada marca por transportadora. */}
              {lot.guidesByBrand &&
                sortBrands(Object.keys(lot.guidesByBrand)).map((b) => {
                  const counts = lot.guidesByBrand![b];
                  return (
                    <tr key={b} className="text-[11.5px]">
                      <td className="py-1 pr-2 pl-4" colSpan={2}>
                        ↳ {brandLabel(b)}
                      </td>
                      {lot.carriers.map((c) => (
                        <td key={c} className="py-1 px-1.5 text-right font-mono">
                          {counts[c] ?? "–"}
                        </td>
                      ))}
                      <td className="py-1 px-1.5 text-right font-mono font-semibold">{Object.values(counts).reduce((s, n) => s + n, 0)}</td>
                      <td />
                    </tr>
                  );
                })}
            </tbody>
          </table>
        )}

        {lot.provisional.length > 0 && (
          // Pedido del usuario 2026-09-28 (temporal): productos de ALF con ID
          // provisional — no están en INVESTOCK, se sacan con esta lista.
          <div className="mb-6">
            <div className="text-[13px] font-bold border-b-2 border-black pb-1 mb-1">ID provisional — no están en INVESTOCK (no se escanean)</div>
            <table className="w-full text-[12px] border-collapse">
              <thead>
                <tr className="text-left border-b border-gray-400">
                  <th className="py-1 pr-2">ID</th>
                  <th className="py-1 pr-2">Producto</th>
                  {lot.carriers.map((c) => (
                    <th key={c} className="py-1 px-1.5 text-right whitespace-nowrap">
                      {carrierLabel(c)}
                    </th>
                  ))}
                  <th className="py-1 px-1.5 text-right">Total</th>
                  <th className="py-1 pl-2 text-center">Sacado</th>
                </tr>
              </thead>
              <tbody>
                {lot.provisional.map((p) => (
                  <tr key={p.code} className="border-b border-gray-300 align-top" style={{ breakInside: "avoid" }}>
                    <td className="py-1.5 pr-2 font-mono font-bold">{p.code}</td>
                    <td className="py-1.5 pr-2">
                      <div className="font-semibold">{p.name}</div>
                      {p.variants.length > 0 && <div className="text-[10.5px] text-gray-600">{p.variants.join(" · ")}</div>}
                    </td>
                    {lot.carriers.map((c) => (
                      <td key={c} className="py-1.5 px-1.5 text-right font-mono">
                        {p.byCarrier[c] ?? "–"}
                      </td>
                    ))}
                    <td className="py-1.5 px-1.5 text-right font-mono font-bold">{p.quantity}</td>
                    <td className="py-1.5 pl-2">
                      <div className="w-12 h-5 border border-gray-500 mx-auto" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {lot.warranty.length > 0 && (
          <div className="mb-6">
            <div className="text-[13px] font-bold border-b-2 border-black pb-1 mb-1">Garantías</div>
            <table className="w-full text-[12px] border-collapse">
              <thead>
                <tr className="text-left border-b border-gray-400">
                  <th className="py-1 pr-2">ID</th>
                  <th className="py-1 pr-2">Producto</th>
                  <th className="py-1 pr-2">Qué sale</th>
                  <th className="py-1 pr-2">Guía</th>
                  <th className="py-1 pr-2">Transportadora</th>
                  <th className="py-1 px-1.5 text-right">Cant.</th>
                  <th className="py-1 pl-2 text-center">Sacado</th>
                </tr>
              </thead>
              <tbody>
                {lot.warranty.map((w, i) => (
                  <tr key={`${w.guide}-${w.catalogItemId}-${i}`} className="border-b border-gray-300 align-top" style={{ breakInside: "avoid" }}>
                    <td className="py-1.5 pr-2 font-mono font-bold">{w.justCode ?? "—"}</td>
                    <td className="py-1.5 pr-2 font-semibold">{w.name}</td>
                    <td className="py-1.5 pr-2">{warrantyText(w.mode, w.piece)}</td>
                    <td className="py-1.5 pr-2 font-mono">{w.guide}</td>
                    <td className="py-1.5 pr-2">{carrierLabel(w.carrier)}</td>
                    <td className="py-1.5 px-1.5 text-right font-mono font-bold">{w.quantity}</td>
                    <td className="py-1.5 pl-2">
                      <div className="w-12 h-5 border border-gray-500 mx-auto" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="grid grid-cols-2 gap-10 text-[12px] mt-10">
          <div className="border-t border-black pt-1">Preparado por (Inventario)</div>
          <div className="border-t border-black pt-1">Revisado por (Daniel)</div>
        </div>
      </div>
    </div>
  );
}
