"use client";

import { useState } from "react";
import type { SnapshotProduct } from "@/lib/provedixSnapshot";
import { PvxPhoto } from "@/components/pvx/PvxPhoto";
import { PvxSalesCurve } from "@/components/pvx/PvxSalesCurve";
import { WhatsAppButton } from "@/components/pvx/PvxContact";
import { IconCheck, IconClock, IconClose, IconCopy, IconExternal, IconFlame, IconSpark } from "@/components/pvx/PvxIcons";

const BRAND = { MKT_PROVEDIX: "Provedix", MKT_DAMIAN: "Importadora Damián" } as const;

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

// Abre la búsqueda de Dropi con ese ID, en otra pestaña (pedido 2026-10-12:
// llegar al producto en Dropi con un clic).
// block: ocupa todo el ancho (tarjetas del catálogo, para que en celular no se desarme).
export function DropiLink({ code, compact = false, block = false }: { code: string; compact?: boolean; block?: boolean }) {
  return (
    <a
      href={`https://app.dropi.ec/dashboard/search?search=${encodeURIComponent(code)}&search_type=semantic`}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={`pvx-press inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-full bg-[#F95B02] text-white font-bold hover:bg-[#DD4F00] ${block ? "w-full" : ""} ${compact ? "px-2.5 py-1.5 text-[12px]" : "px-4 py-2 text-[13.5px]"}`}
    >
      {block ? "Dropi" : "Ver en Dropi"} <IconExternal className={compact ? "w-3 h-3" : "w-3.5 h-3.5"} />
    </a>
  );
}

// label: "Dropi" o "Rocket" — el mismo producto en cada una (2026-10-12).
// En Rocket se busca por SKU (kind="SKU"), que es largo: puede partirse.
export function CopyId({ code, label, kind = "ID" }: { code: string; label?: string; kind?: "ID" | "SKU" }) {
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
      className="pvx-press inline-flex max-w-full items-center gap-1.5 rounded-full bg-[#F4F4F2] px-3.5 py-2 text-[13px] font-bold hover:bg-[#FFF1E8] cursor-pointer"
    >
      {label && <span className="shrink-0 text-[11.5px] font-bold text-[#6B717B]">{label}</span>}
      <span className={`pvx-num tracking-wide ${kind === "SKU" ? "break-all text-left" : ""}`}>{code}</span> <span className="inline-flex shrink-0 items-center gap-1 text-[11.5px] text-[#C24400]">{copied ? <><IconCheck className="w-3.5 h-3.5" /> Copiado</> : <IconCopy className="w-3.5 h-3.5" />}</span>
    </button>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="h-full rounded-2xl bg-[#F4F4F2] p-3.5">
      <div className="text-[12.5px] font-bold text-[#4A4F58]">{label}</div>
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
          <span className={`truncate ${r.muted ? "text-[#6B717B]" : "font-semibold"}`}>{r.label}</span>
          <div className="h-2 rounded-full bg-white overflow-hidden">
            <div
              className={`h-full rounded-full ${r.muted ? "bg-[#c9c5bc]" : "bg-[#F95B02]"}`}
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
        className="pvx-press absolute top-3 right-3 z-10 grid w-10 h-10 place-items-center rounded-full bg-[#111214]/75 text-white hover:bg-[#111214] cursor-pointer"
      >
        <IconClose className="w-5 h-5" />
      </button>

      <div className="md:bg-[#F4F4F2]">
        {/* En computadora la foto se achica según el alto de la pantalla, para que la ficha entre completa. */}
        <div className="relative aspect-[16/9] md:aspect-auto md:h-[min(36vh,340px)] bg-[#E9E9E6]">
          <PvxPhoto src={p.photo} alt={p.name} sizes="(max-width: 768px) 100vw, 420px" priority />
        </div>
        <div className="p-4">
          {/* "En subida" va acá y no sobre la foto: tapaba datos de la imagen (pedido 2026-10-12). */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="pvx-num text-[13px] font-black italic text-[#C24400]">#{p.rank} más vendido</span>
            <span className="text-[12px] font-semibold text-[#6B717B]">{BRAND[p.brand]}</span>
            {p.trend === "up" && <span className="inline-flex items-center gap-1 rounded-full bg-[#F95B02] text-white text-[11px] font-bold px-2.5 py-0.5"><IconFlame className="w-3 h-3" /> En subida</span>}
          </div>
          <h2 className="pvx-heading text-[24px] mt-1.5">{p.name}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <CopyId code={p.code} label="Dropi" />
            <DropiLink code={p.code} />
            {(p.rocketSkus ?? []).map((r) => (
              <CopyId key={r} code={r} label="Rocket" kind="SKU" />
            ))}
            <span className="text-[11.5px] text-[#4A4F58]">
              {(p.rocketSkus ?? []).length > 0 ? "Es el mismo producto: búscalo con su ID en Dropi o con su SKU en Rocket." : "Búscalo con este ID en Dropi para venderlo."}
            </span>
          </div>

          {/* Stock de nuestra bodega (sí/no, nunca cantidades) + asesor por WhatsApp — pedido 2026-10-12. */}
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {p.stock === "out" ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#fff4e0] text-[#8a4b00] text-[12.5px] font-bold px-3 py-1.5"><IconClock className="w-3.5 h-3.5" /> Agotado por ahora · llega más stock</span>
            ) : p.stock === "new" ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e7f6ed] text-[#0f6b35] text-[12.5px] font-bold px-3 py-1.5"><IconSpark className="w-3.5 h-3.5" /> ¡Llegó nuevo stock!</span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e7f6ed] text-[#0f6b35] text-[12.5px] font-bold px-3 py-1.5"><IconCheck className="w-3.5 h-3.5" /> Hay stock disponible</span>
            )}
            <WhatsAppButton p={p} outOfStock={p.stock === "out"} />
            {(p.rocketSkus ?? []).length > 0 && <WhatsAppButton p={p} outOfStock={p.stock === "out"} advisor="rocket" />}
          </div>

          <div className="mt-4 rounded-[22px] bg-[#0d0e11] text-white p-4">
            <div className="text-[11.5px] text-white/70">Últimos 30 días</div>
            <div className="pvx-heading mt-1 text-[26px]">{p.soldRange} <span className="text-[16px] not-italic font-semibold text-white/80">vendidos</span></div>
            <div className="text-[12.5px] text-white/80">{p.unitsRange} unidades</div>
            {offer && (
              <div className="mt-2.5 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-white/10 p-2">
                  <div className="text-[10.5px] text-white/70">Se vende a</div>
                  <div className="text-[16px] font-bold">{money(offer.price)}</div>
                  {offer.units > 1 && <div className="text-[10.5px] text-white/70">{offer.units} unidades</div>}
                </div>
                <div className="rounded-xl bg-white/10 p-2">
                  <div className="text-[10.5px] text-white/70">Te cuesta</div>
                  <div className="text-[16px] font-bold">{p.dropiPrice != null ? money(p.dropiPrice * offer.units) : "—"}</div>
                </div>
                <div className="rounded-xl bg-[#F95B02] p-2">
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
                <span className="font-bold text-[#C24400]">{p.women}% mujeres</span>
                <span className="font-bold text-[#2f6fd6]">{100 - p.women}% hombres</span>
              </div>
              <div className="mt-1.5 flex h-2.5 rounded-full overflow-hidden bg-white">
                <div className="bg-[#F95B02]" style={{ width: `${p.women}%` }} />
                <div className="bg-[#2f6fd6]" style={{ width: `${100 - p.women}%` }} />
              </div>
              <div className="mt-1 text-[10.5px] text-[#6B717B]">Aproximado</div>
            </Stat>
          )}
          {p.deliveryRate != null && (
            <Stat label="Se entrega">
              <div className="flex items-baseline gap-1.5">
                <span className="text-[20px] font-bold text-[#1f9d55] leading-none">{p.deliveryRate}%</span>
                <span className="text-[12px] text-[#4A4F58]">de los pedidos</span>
              </div>
              <div className="mt-2 h-2.5 rounded-full bg-white overflow-hidden">
                <div className="h-full rounded-full bg-[#1f9d55]" style={{ width: `${p.deliveryRate}%` }} />
              </div>
            </Stat>
          )}
          {p.curve && p.curve.some((v) => v > 0) && (
            <Stat label="Tendencia de ventas · 30 días">
              <PvxSalesCurve values={p.curve} tips={p.dailyRanges} />
            </Stat>
          )}
        </div>

        {p.combos.length > 0 && (
          <div className="mt-3">
            <div className="text-[14px] font-bold">{p.combos.every((c) => c.sold !== false) ? "Combos que más se venden con este producto" : "Combos con este producto"}</div>
            <div className="mt-1.5 flex flex-col gap-1">
              {p.combos.map((c) => (
                <div key={c.code} className="flex items-center gap-2.5 rounded-2xl bg-[#F4F4F2] px-2.5 py-2">
                  <div className="relative w-10 h-10 rounded-xl overflow-hidden bg-white shrink-0">
                    <PvxPhoto src={c.photos[0] ?? null} alt={c.name} sizes="40px" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-semibold leading-snug line-clamp-1">{c.name}</div>
                    {c.sold === false ? (
                      <div className="text-[11px] font-semibold text-[#C24400]">Nuevo · listo para vender</div>
                    ) : (
                      <div className="text-[11px] text-[#4A4F58]">
                        {c.unitsRange} vendidos{c.price != null ? ` · se vende a ${money(c.price)}` : ""}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <div className="flex items-center gap-1">
                      <CopyId code={c.code} label="Dropi" />
                      <DropiLink code={c.code} compact />
                    </div>
                    {(c.rocketSkus ?? []).map((r) => (
                      <CopyId key={r} code={r} label="Rocket" kind="SKU" />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="mt-3 text-[10.5px] text-[#6B717B]">Datos reales de despacho de nuestras bodegas, en rangos.</div>
      </div>
    </div>
  );
}
