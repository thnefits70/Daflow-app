"use client";

import { useState } from "react";
import type { SnapshotProduct } from "@/lib/provedixSnapshot";
import { PvxPhoto } from "@/components/pvx/PvxPhoto";
import { PvxSalesCurve } from "@/components/pvx/PvxSalesCurve";

const BRAND = { MKT_PROVEDIX: "Provedix", MKT_DAMIAN: "Importadora Damián" } as const;

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

export function CopyId({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText(code).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        });
      }}
      className="inline-flex items-center gap-1.5 rounded-md border border-[#d9d6cf] bg-white px-2.5 py-1 font-mono text-[12.5px] hover:border-[#ff5a1f] cursor-pointer"
    >
      ID {code} <span className="text-[11px] font-sans text-[#ff5a1f] font-semibold">{copied ? "¡Copiado!" : "Copiar"}</span>
    </button>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="h-full rounded-lg bg-white border border-[#ebe8e1] p-3">
      <div className="text-[10.5px] font-bold uppercase tracking-wide text-[#8a8f98]">{label}</div>
      <div className="mt-1 text-[14px]">{children}</div>
    </div>
  );
}

function Bars({ rows }: { rows: { label: string; pct: number; muted?: boolean }[] }) {
  const max = Math.max(...rows.map((r) => r.pct), 1);
  return (
    <div className="mt-1.5 flex flex-col gap-1">
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[76px_1fr_34px] items-center gap-2 text-[12px]">
          <span className={`truncate ${r.muted ? "text-[#8a8f98]" : "font-semibold"}`}>{r.label}</span>
          <div className="h-2 rounded-full bg-[#f1efea] overflow-hidden">
            <div
              className={`h-full rounded-full ${r.muted ? "bg-[#c9c5bc]" : "bg-[#ff5a1f]"}`}
              style={{ width: `${(r.pct / max) * 100}%` }}
            />
          </div>
          <span className="text-right font-bold tabular-nums">{r.pct}%</span>
        </div>
      ))}
    </div>
  );
}

// Ficha en una sola vista (pedido del usuario 2026-10-12: "con un clic se
// vea toda la información sin scrollear"): en pantallas medianas y grandes,
// dos columnas — foto + precios a la izquierda, el resto a la derecha — y
// todo más compacto. En celular sigue en una columna, más corta.
export function PvxProductDetail({ p, onClose }: { p: SnapshotProduct; onClose: () => void }) {
  const offer = p.offers[0];
  return (
    <div className="relative md:grid md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <button
        type="button"
        onClick={onClose}
        aria-label="Cerrar"
        className="absolute top-3 right-3 z-10 w-9 h-9 rounded-full bg-black/60 text-white text-[20px] leading-none cursor-pointer"
      >
        ×
      </button>

      <div className="md:border-r md:border-[#ebe8e1]">
        {/* En computadora la foto se achica según el alto de la pantalla, para que la ficha entre completa. */}
        <div className="relative aspect-[16/9] md:aspect-auto md:h-[min(36vh,340px)] bg-[#ebe8e1]">
          <PvxPhoto src={p.photo} alt={p.name} sizes="(max-width: 768px) 100vw, 420px" priority />
        </div>
        <div className="p-4">
          {/* "En subida" va acá y no sobre la foto: tapaba datos de la imagen (pedido 2026-10-12). */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-[.12em] text-[#ff5a1f]">{BRAND[p.brand]} · #{p.rank} más vendido</span>
            {p.trend === "up" && <span className="rounded-full bg-[#ff5a1f] text-white text-[11px] font-bold px-2.5 py-0.5">🔥 En subida</span>}
          </div>
          <h2 className="text-[19px] font-bold leading-snug mt-0.5">{p.name}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <CopyId code={p.code} />
            <span className="text-[11.5px] text-[#5b616b]">Búscalo con este ID en Dropi para venderlo.</span>
          </div>

          <div className="mt-3 rounded-xl bg-[#16181d] text-white p-3.5">
            <div className="text-[11.5px] text-white/70">Últimos 30 días</div>
            <div className="text-[21px] font-bold leading-tight">🔥 {p.soldRange} vendidos</div>
            <div className="text-[12.5px] text-white/80">{p.unitsRange} unidades</div>
            {offer && (
              <div className="mt-2.5 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-white/10 p-1.5">
                  <div className="text-[10.5px] text-white/70">Se vende a</div>
                  <div className="text-[16px] font-bold">{money(offer.price)}</div>
                  {offer.units > 1 && <div className="text-[10.5px] text-white/70">{offer.units} unidades</div>}
                </div>
                <div className="rounded-lg bg-white/10 p-1.5">
                  <div className="text-[10.5px] text-white/70">Te cuesta</div>
                  <div className="text-[16px] font-bold">{p.dropiPrice != null ? money(p.dropiPrice * offer.units) : "—"}</div>
                </div>
                <div className="rounded-lg bg-[#ff5a1f] p-1.5">
                  <div className="text-[10.5px] text-white/85">Ganas aprox.</div>
                  <div className="text-[16px] font-bold">{p.marginApprox != null ? money(p.marginApprox) : "—"}</div>
                </div>
              </div>
            )}
            {offer && <div className="text-[10.5px] text-white/60 mt-1.5">Ganancia antes de flete y publicidad. Precio más común entre las ventas reales.</div>}
            {p.offers.length > 1 && (
              <div className="mt-2 pt-2 border-t border-white/10 text-[11.5px]">
                <span className="text-white/60">Otros precios que funcionan: </span>
                <span className="font-semibold">{p.offers.map((o) => `${money(o.price)}${o.units > 1 ? ` (${o.units} u.)` : ""}`).join(" · ")}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="p-4 md:pt-12">
        <div className="grid grid-cols-1 min-[480px]:grid-cols-2 gap-2">
          {p.qtyMix && (
            <Stat label="Cuántas unidades piden">
              <Bars
                rows={[
                  { label: "1 unidad", pct: p.qtyMix.one },
                  { label: "2 unidades", pct: p.qtyMix.two },
                  { label: "3 o más", pct: p.qtyMix.threePlus },
                ]}
              />
            </Stat>
          )}
          {p.cities.length > 0 && (
            <div className="min-[480px]:row-span-2">
              <Stat label="Dónde se vende más">
                <Bars
                  rows={[
                    ...p.cities.map((c) => ({ label: c.city, pct: c.share })),
                    ...(() => {
                      const rest = 100 - p.cities.reduce((s, c) => s + c.share, 0);
                      return rest > 0 ? [{ label: "Otras", pct: rest, muted: true }] : [];
                    })(),
                  ]}
                />
              </Stat>
            </div>
          )}
          {p.women != null && (
            <Stat label="Quién lo compra">
              <div className="flex items-baseline justify-between gap-2 text-[12px] mt-0.5">
                <span className="font-bold text-[#ff5a1f]">👩 {p.women}% mujeres</span>
                <span className="font-bold text-[#2f6fd6]">{100 - p.women}% hombres 👨</span>
              </div>
              <div className="mt-1.5 flex h-2.5 rounded-full overflow-hidden bg-[#f1efea]">
                <div className="bg-[#ff5a1f]" style={{ width: `${p.women}%` }} />
                <div className="bg-[#2f6fd6]" style={{ width: `${100 - p.women}%` }} />
              </div>
              <div className="mt-1 text-[10.5px] text-[#8a8f98]">Aproximado</div>
            </Stat>
          )}
          {p.deliveryRate != null && (
            <Stat label="Se entrega">
              <div className="flex items-baseline gap-1.5">
                <span className="text-[20px] font-bold text-[#1f9d55] leading-none">{p.deliveryRate}%</span>
                <span className="text-[12px] text-[#5b616b]">de los pedidos</span>
              </div>
              <div className="mt-2 h-2.5 rounded-full bg-[#f1efea] overflow-hidden">
                <div className="h-full rounded-full bg-[#1f9d55]" style={{ width: `${p.deliveryRate}%` }} />
              </div>
            </Stat>
          )}
          {p.curve && p.curve.some((v) => v > 0) && (
            <Stat label="Tendencia de ventas · 30 días">
              <PvxSalesCurve values={p.curve} />
            </Stat>
          )}
        </div>

        {p.combos.length > 0 && (
          <div className="mt-3">
            <div className="text-[12.5px] font-bold">Combos que más se venden con este producto</div>
            <div className="mt-1.5 flex flex-col gap-1">
              {p.combos.map((c) => (
                <div key={c.code} className="flex items-center gap-2.5 rounded-lg bg-white border border-[#ebe8e1] px-2 py-1.5">
                  <div className="relative w-9 h-9 rounded-md overflow-hidden bg-[#ebe8e1] shrink-0">
                    <PvxPhoto src={c.photos[0] ?? null} alt={c.name} sizes="36px" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-semibold leading-snug line-clamp-1">{c.name}</div>
                    <div className="text-[11px] text-[#5b616b]">
                      {c.unitsRange} vendidos{c.price != null ? ` · se vende a ${money(c.price)}` : ""}
                    </div>
                  </div>
                  <CopyId code={c.code} />
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="mt-3 text-[10.5px] text-[#8a8f98]">Datos reales de despacho de nuestras bodegas, en rangos y con 7 días de retraso.</div>
      </div>
    </div>
  );
}
