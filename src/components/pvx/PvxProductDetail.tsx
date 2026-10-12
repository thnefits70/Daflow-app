"use client";

import { useState } from "react";
import type { SnapshotProduct } from "@/lib/provedixSnapshot";
import { PvxPhoto } from "@/components/pvx/PvxPhoto";

const BRAND = { MKT_PROVEDIX: "Provedix", MKT_DAMIAN: "Importadora Damián" } as const;

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

function CopyId({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
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
    <div className="rounded-lg bg-white border border-[#ebe8e1] p-3">
      <div className="text-[10.5px] font-bold uppercase tracking-wide text-[#8a8f98]">{label}</div>
      <div className="mt-1 text-[14px]">{children}</div>
    </div>
  );
}

export function PvxProductDetail({ p, onClose }: { p: SnapshotProduct; onClose: () => void }) {
  const offer = p.offers[0];
  return (
    <div>
      <div className="relative aspect-[4/3] sm:aspect-[16/9] bg-[#ebe8e1]">
        <PvxPhoto src={p.photo} alt={p.name} sizes="(max-width: 640px) 100vw, 640px" priority />
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="absolute top-3 right-3 w-9 h-9 rounded-full bg-black/60 text-white text-[20px] leading-none cursor-pointer"
        >
          ×
        </button>
        {p.trend === "up" && <span className="absolute top-3 left-3 rounded-full bg-[#ff5a1f] text-white text-[12px] font-bold px-3 py-1">🔥 En subida</span>}
      </div>
      <div className="p-5 sm:p-6">
        <div className="text-[11px] font-bold uppercase tracking-[.12em] text-[#ff5a1f]">{BRAND[p.brand]} · #{p.rank} más vendido</div>
        <h2 className="text-[21px] font-bold leading-snug mt-1">{p.name}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <CopyId code={p.code} />
          <span className="text-[12px] text-[#5b616b]">Búscalo con este ID en Dropi para venderlo.</span>
        </div>

        <div className="mt-4 rounded-xl bg-[#16181d] text-white p-4">
          <div className="text-[12px] text-white/70">Últimos 30 días</div>
          <div className="text-[24px] font-bold mt-0.5">🔥 {p.soldRange} vendidos</div>
          <div className="text-[13px] text-white/80">{p.unitsRange} unidades</div>
          {offer && (
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-white/10 p-2">
                <div className="text-[10.5px] text-white/70">Se vende a</div>
                <div className="text-[17px] font-bold">{money(offer.price)}</div>
                {offer.units > 1 && <div className="text-[10.5px] text-white/70">{offer.units} unidades</div>}
              </div>
              <div className="rounded-lg bg-white/10 p-2">
                <div className="text-[10.5px] text-white/70">Te cuesta</div>
                <div className="text-[17px] font-bold">{p.dropiPrice != null ? money(p.dropiPrice * offer.units) : "—"}</div>
              </div>
              <div className="rounded-lg bg-[#ff5a1f] p-2">
                <div className="text-[10.5px] text-white/85">Ganas aprox.</div>
                <div className="text-[17px] font-bold">{p.marginApprox != null ? money(p.marginApprox) : "—"}</div>
              </div>
            </div>
          )}
          {offer && <div className="text-[11px] text-white/60 mt-2">Ganancia antes de flete y publicidad. Precio más común entre las ventas reales.</div>}
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {p.offers.length > 1 && (
            <Stat label="Otros precios que funcionan">
              {p.offers.map((o) => `${money(o.price)}${o.units > 1 ? ` (${o.units} u.)` : ""}`).join(" · ")}
            </Stat>
          )}
          {p.qtyMix && (
            <Stat label="Cuántas unidades piden">
              1 u. {p.qtyMix.one}% · 2 u. {p.qtyMix.two}% · 3+ {p.qtyMix.threePlus}%
            </Stat>
          )}
          {p.cities.length > 0 && <Stat label="Dónde se vende más">{p.cities.map((c) => `${c.city} ${c.share}%`).join(" · ")}</Stat>}
          {p.women != null && (
            <Stat label="Quién lo compra">
              {p.women >= 50 ? `${p.women}% mujeres` : `${100 - p.women}% hombres`} <span className="text-[11px] text-[#8a8f98]">(aprox.)</span>
            </Stat>
          )}
          {p.deliveryRate != null && <Stat label="Se entrega">✅ {p.deliveryRate}% de los pedidos</Stat>}
        </div>

        {p.combos.length > 0 && (
          <div className="mt-5">
            <div className="text-[13px] font-bold">Combos que más se venden con este producto</div>
            <div className="mt-2 flex flex-col gap-2">
              {p.combos.map((c) => (
                <div key={c.code} className="flex items-center gap-3 rounded-lg bg-white border border-[#ebe8e1] p-2.5">
                  <div className="relative w-14 h-14 rounded-md overflow-hidden bg-[#ebe8e1] shrink-0">
                    <PvxPhoto src={c.photos[0] ?? null} alt={c.name} sizes="56px" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold leading-snug line-clamp-2">{c.name}</div>
                    <div className="text-[11.5px] text-[#5b616b]">
                      {c.unitsRange} vendidos{c.price != null ? ` · se vende a ${money(c.price)}` : ""}
                    </div>
                  </div>
                  <CopyId code={c.code} />
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="mt-5 text-[11px] text-[#8a8f98]">Datos reales de despacho de nuestras bodegas, en rangos y con 7 días de retraso.</div>
      </div>
    </div>
  );
}
