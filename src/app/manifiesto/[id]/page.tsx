import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { canViewFulfillmentRequests } from "@/lib/guards";
import { getCompiledLot, manifestCode } from "@/lib/fulfillmentGuides";
import { carrierLabel, CARRIER_ORDER } from "@/lib/carriers";
import { PrintButton } from "./PrintButton";

function fmtDay(day: string) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("es-EC", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

function fmtTime(d: Date) {
  return d.toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit", timeZone: "America/Guayaquil" });
}

function warrantyText(mode: string, piece: string | null) {
  if (mode === "PIECE") return `Solo pieza: ${piece}`;
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
  const lot = await getCompiledLot(id);
  if (!lot) notFound();

  if (!lot.manifestNumber) {
    return (
      <div className="min-h-screen bg-white text-black p-10 text-center text-[14px]">
        Este corte todavía no tiene manifiesto. Imprímelo desde la pestaña Solicitud Fulfillment.
      </div>
    );
  }

  // Primero lo que va a la transportadora de mayor prioridad; dentro de
  // cada grupo, de mayor a menor cantidad.
  const rank = (byCarrier: Record<string, number>) => {
    const i = CARRIER_ORDER.findIndex((c) => (byCarrier[c] ?? 0) > 0);
    return i === -1 ? CARRIER_ORDER.length : i;
  };
  const lines = [...lot.lines].sort((a, b) => rank(a.byCarrier) - rank(b.byCarrier) || b.quantity - a.quantity);
  const totals = lot.carriers.map((c) => lines.reduce((s, l) => s + (l.byCarrier[c] ?? 0), 0));
  const units = lines.reduce((s, l) => s + l.quantity, 0);

  return (
    <div className="min-h-screen bg-white text-black py-8 px-6 print:p-0">
      <PrintButton />
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
              {lines.map((l) => (
                <tr key={l.catalogItemId} className="border-b border-gray-300 align-top" style={{ breakInside: "avoid" }}>
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
            </tbody>
          </table>
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
