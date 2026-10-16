"use client";

import { useState } from "react";
import type { SnapshotProduct } from "@/lib/provedixSnapshot";
import { productAlt, PvxPhoto } from "@/components/pvx/PvxPhoto";
import { PvxDailyBars, PvxSalesCurve } from "@/components/pvx/PvxSalesCurve";
import { WhatsAppButton } from "@/components/pvx/PvxContact";
import { PVX_CALC_EVENT } from "@/components/pvx/PvxCalculator";
import {
  IconCalc,
  IconCheck,
  IconClock,
  IconClose,
  IconCopy,
  IconExternal,
  IconFlame,
  IconSpark,
} from "@/components/pvx/PvxIcons";

const BRAND = {
  MKT_PROVEDIX: "Provedix",
  MKT_DAMIAN: "Importadora Damián",
} as const;

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

// Abre la búsqueda de Dropi con ese ID, en otra pestaña (pedido 2026-10-12:
// llegar al producto en Dropi con un clic).
// block: ocupa todo el ancho (tarjetas del catálogo, para que en celular no se desarme).
export function DropiLink({
  code,
  compact = false,
  block = false,
}: {
  code: string;
  compact?: boolean;
  block?: boolean;
}) {
  return (
    <a
      href={`https://app.dropi.ec/dashboard/search?search=${encodeURIComponent(code)}&search_type=semantic`}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={`pvx-press inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-full bg-[#F95B02] text-white font-bold hover:bg-[#DD4F00] ${block ? "w-full" : ""} ${compact ? "px-2.5 py-1.5 text-[12px]" : "px-4 py-2 text-[13.5px]"}`}
    >
      {block ? "Dropi" : "Ver en Dropi"}{" "}
      <IconExternal className={compact ? "w-3 h-3" : "w-3.5 h-3.5"} />
    </a>
  );
}

// label: "Dropi" o "Rocket" — el mismo producto en cada una (2026-10-12).
// En Rocket se busca por SKU (kind="SKU"), que es largo: puede partirse.
export function CopyId({
  code,
  label,
  kind = "ID",
}: {
  code: string;
  label?: string;
  kind?: "ID" | "SKU";
}) {
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
      {label && (
        <span className="shrink-0 text-[12.5px] font-bold text-[#6B717B]">
          {label}
        </span>
      )}
      <span
        translate="no"
        className={`pvx-num tracking-wide ${kind === "SKU" ? "break-all text-left" : ""}`}
      >
        {code}
      </span>{" "}
      <span className="inline-flex shrink-0 items-center gap-1 text-[12.5px] text-[#C24400]">
        {copied ? (
          <>
            <IconCheck className="w-3.5 h-3.5" /> Copiado
          </>
        ) : (
          <IconCopy className="w-3.5 h-3.5" />
        )}
      </span>
    </button>
  );
}

function Stat({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="h-full rounded-2xl bg-[#F4F4F2] p-3">
      <div className="text-[12.5px] font-bold text-[#4A4F58]">{label}</div>
      <div className="mt-1 text-[14px]">{children}</div>
    </div>
  );
}

function Bars({
  rows,
  labelWidth = 76,
}: {
  rows: { label: string; pct: number; muted?: boolean }[];
  labelWidth?: number;
}) {
  const max = Math.max(...rows.map((r) => r.pct), 1);
  return (
    <div className="mt-1.5 flex flex-col gap-1">
      {rows.map((r) => (
        <div
          key={r.label}
          className="grid items-center gap-2 text-[12px]"
          style={{ gridTemplateColumns: `${labelWidth}px 1fr 34px` }}
        >
          <span
            className={`truncate ${r.muted ? "text-[#6B717B]" : "font-semibold"}`}
          >
            {r.label}
          </span>
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

type Tab = "resumen" | "ventas" | "combos";

// Ficha en UN solo cuadro, sin bajar (pedido del usuario 2026-10-14, en
// celular y en computadora): en computadora, resumen a la izquierda y
// pestañas a la derecha; en celular, todo en pestañas. La foto se ve
// completa (sin recortar) y la tendencia es por barras de cada día.
export function PvxProductDetail({
  p,
  onClose,
}: {
  p: SnapshotProduct;
  onClose: () => void;
}) {
  const offer = p.offers[0];
  const hasTrend =
    (p.dailyRanges?.length ?? 0) > 0 || (p.curve?.some((v) => v > 0) ?? false);
  const hasClients =
    !!p.qtyMix ||
    p.cities.length > 0 ||
    p.women != null ||
    p.deliveryRate != null;
  const tabs = (
    [
      ["resumen", "Resumen", true],
      [
        "ventas",
        hasTrend && hasClients
          ? "Ventas y clientes"
          : hasTrend
            ? "Ventas"
            : "Clientes",
        hasTrend || hasClients,
      ],
      [
        "combos",
        `Combos${p.combos.length ? ` (${p.combos.length})` : ""}`,
        p.combos.length > 0,
      ],
    ] as const
  ).filter(([, , show]) => show);
  const [tab, setTab] = useState<Tab>("resumen");
  // En computadora el resumen siempre está a la izquierda: la derecha muestra
  // la pestaña elegida (o la primera que no sea el resumen).
  const right: Tab =
    tab === "resumen"
      ? ((tabs.find(([k]) => k !== "resumen")?.[0] as Tab | undefined) ??
        "resumen")
      : tab;

  const stock =
    p.stock === "out" ? (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#fff4e0] px-2.5 py-1 text-[12px] font-bold text-[#8a4b00]">
        <IconClock className="w-3.5 h-3.5" /> Agotado · llega más stock
      </span>
    ) : p.stock === "new" ? (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e7f6ed] px-2.5 py-1 text-[12px] font-bold text-[#0f6b35]">
        <IconSpark className="w-3.5 h-3.5" /> ¡Llegó nuevo stock!
      </span>
    ) : (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e7f6ed] px-2.5 py-1 text-[12px] font-bold text-[#0f6b35]">
        <IconCheck className="w-3.5 h-3.5" /> Hay stock
      </span>
    );

  const summary = (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex min-h-0 gap-3">
        {/* Foto completa, sin recortar. */}
        <div className="relative aspect-square w-[44%] max-w-[210px] shrink-0 overflow-hidden rounded-2xl bg-white">
          <PvxPhoto
            src={p.photo}
            alt={productAlt(p.name)}
            sizes="210px"
            priority
            fit="contain"
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="pvx-num text-[13px] font-black italic text-[#C24400]">
              #{p.rank} más vendido
            </span>
            {p.trend === "up" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#F95B02] px-2 py-0.5 text-[12px] font-bold text-white">
                <IconFlame className="w-3 h-3" /> En subida
              </span>
            )}
          </div>
          <h2 className="pvx-heading mt-1 line-clamp-3 text-[19px] sm:text-[22px]">
            {p.name}
          </h2>
          <div className="mt-1 text-[12px] font-semibold text-[#6B717B]">
            {BRAND[p.brand]}
          </div>
          <div className="mt-2">{stock}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <CopyId code={p.code} label="Dropi" />
        <DropiLink code={p.code} />
        {(p.rocketSkus ?? []).map((r) => (
          <CopyId key={r} code={r} label="Rocket" kind="SKU" />
        ))}
        {/* Calculadora de ganancia con este producto (2026-10-15). */}
        <button
          type="button"
          onClick={() => {
            onClose();
            window.dispatchEvent(
              new CustomEvent(PVX_CALC_EVENT, { detail: p.code }),
            );
          }}
          className="pvx-press inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-[#d9dbe0] bg-white px-4 py-2 text-[13.5px] font-bold hover:border-[#F95B02] cursor-pointer"
        >
          <IconCalc className="w-4 h-4 text-[#F95B02]" /> Calcular mi ganancia
        </button>
      </div>

      <div className="rounded-[20px] bg-[#0d0e11] p-3.5 text-white">
        <div className="flex items-baseline justify-between gap-2">
          <div className="pvx-heading text-[22px]">
            {p.soldRange}{" "}
            <span className="text-[14px] font-semibold not-italic text-white/80">
              vendidos
            </span>
          </div>
          <div className="text-right text-[12.5px] text-white/70">
            30 días · {p.unitsRange} u.
          </div>
        </div>
        {offer && (
          <div className="mt-2 grid grid-cols-3 gap-1.5 text-center">
            <div className="rounded-xl bg-white/10 px-1 py-1.5">
              <div className="text-[10.5px] text-white/70">Se vende a</div>
              <div className="pvx-num text-[16px] font-bold">
                {money(offer.price)}
              </div>
              {offer.units > 1 && (
                <div className="text-[11.5px] text-white/70">
                  {offer.units} unidades
                </div>
              )}
            </div>
            <div className="rounded-xl bg-white/10 px-1 py-1.5">
              <div className="text-[10.5px] text-white/70">Te cuesta</div>
              <div className="pvx-num text-[16px] font-bold">
                {p.dropiPrice != null ? money(p.dropiPrice * offer.units) : "—"}
              </div>
            </div>
            <div className="rounded-xl bg-[#F95B02] px-1 py-1.5">
              <div className="text-[10.5px] text-white/90">Ganas aprox.</div>
              <div className="pvx-num text-[16px] font-bold">
                {p.marginApprox != null ? money(p.marginApprox) : "—"}
              </div>
            </div>
          </div>
        )}
        {p.offers.length > 1 && (
          <div className="mt-1.5 truncate text-[12px] text-white/70">
            También se vende a:{" "}
            <span className="font-semibold text-white">
              {p.offers
                .slice(1)
                .map(
                  (o) =>
                    `${money(o.price)}${o.units > 1 ? ` (${o.units} u.)` : ""}`,
                )
                .join(" · ")}
            </span>
          </div>
        )}
        {offer && (
          <div className="mt-1 text-[10.5px] text-white/55">
            Ganancia antes de flete y publicidad.
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 lg:mt-auto">
        <WhatsAppButton p={p} outOfStock={p.stock === "out"} />
        {(p.rocketSkus ?? []).length > 0 && (
          <WhatsAppButton
            p={p}
            outOfStock={p.stock === "out"}
            advisor="rocket"
          />
        )}
      </div>
    </div>
  );

  const trend = p.dailyRanges?.length ? (
    <PvxDailyBars
      ranges={p.dailyRanges}
      heightClass="h-[96px] min-[400px]:h-[120px] lg:h-[124px]"
    />
  ) : p.curve ? (
    <PvxSalesCurve values={p.curve} height={130} />
  ) : null;

  const clients = (
    <div className="grid grid-flow-row-dense grid-cols-2 gap-2">
      {p.qtyMix && (
        <Stat label="Unidades por pedido">
          <Bars
            labelWidth={34}
            rows={[
              { label: "1", pct: p.qtyMix.one },
              { label: "2", pct: p.qtyMix.two },
              { label: "3+", pct: p.qtyMix.threePlus },
            ]}
          />
        </Stat>
      )}
      {p.cities.length > 0 && (
        <div className="col-span-2 sm:col-span-1 sm:row-span-2">
          <Stat label="Dónde se vende más">
            <Bars
              rows={[
                ...p.cities.map((c) => ({
                  label: c.city,
                  pct: c.share,
                  muted: c.city === "Otras",
                })),
                ...(() => {
                  const rest = 100 - p.cities.reduce((s, c) => s + c.share, 0);
                  return rest > 0 && !p.cities.some((c) => c.city === "Otras")
                    ? [{ label: "Otras", pct: rest, muted: true }]
                    : [];
                })(),
              ]}
            />
          </Stat>
        </div>
      )}
      {p.women != null && (
        <Stat label="Quién lo compra">
          <div className="mt-0.5 flex flex-wrap items-baseline justify-between gap-x-2 text-[12px]">
            <span className="font-bold text-[#C24400]">{p.women}% mujeres</span>
            <span className="font-bold text-[#2f6fd6]">
              {100 - p.women}% hombres
            </span>
          </div>
          <div className="mt-1.5 flex h-2.5 overflow-hidden rounded-full bg-white">
            <div className="bg-[#F95B02]" style={{ width: `${p.women}%` }} />
            <div
              className="bg-[#2f6fd6]"
              style={{ width: `${100 - p.women}%` }}
            />
          </div>
        </Stat>
      )}
      {p.deliveryRate != null && (
        <Stat label="Se entrega (sin devolución)">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[20px] font-bold leading-none text-[#1f9d55]">
              {p.deliveryRate}%
            </span>
            <span className="text-[12px] text-[#4A4F58]">de los pedidos</span>
          </div>
          <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-white">
            <div
              className="h-full rounded-full bg-[#1f9d55]"
              style={{ width: `${p.deliveryRate}%` }}
            />
          </div>
        </Stat>
      )}
    </div>
  );

  const combos = (
    <div className="flex flex-col gap-1.5">
      <div className="text-[13px] font-bold">
        {p.combos.every((c) => c.sold !== false)
          ? "Combos que más se venden con este producto"
          : "Combos con este producto"}
      </div>
      {p.combos.map((c) => (
        <div
          key={c.code}
          className="grid grid-cols-[44px_minmax(0,1fr)] gap-x-2.5 gap-y-1.5 rounded-2xl bg-[#F4F4F2] px-2.5 py-2 sm:grid-cols-[44px_minmax(0,1fr)_auto] sm:items-center"
        >
          <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-white">
            <PvxPhoto
              src={c.photos[0] ?? null}
              alt={c.name}
              sizes="44px"
              fit="contain"
            />
          </div>
          <div className="min-w-0">
            <div className="line-clamp-2 text-[12.5px] font-semibold leading-snug">
              {c.name}
            </div>
            {c.sold === false ? (
              <div className="text-[12px] font-semibold text-[#C24400]">
                Nuevo · listo para vender
              </div>
            ) : (
              <div className="text-[12px] text-[#4A4F58]">
                {c.unitsRange} vendidos
                {c.price != null ? ` · se vende a ${money(c.price)}` : ""}
              </div>
            )}
          </div>
          <div className="col-span-2 flex flex-wrap items-center gap-1 sm:col-span-1 sm:flex-col sm:items-end">
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
  );

  // Ventas y clientes juntos (en celular y en computadora caben en un cuadro).
  const ventas = (
    <div className="flex flex-col gap-2">
      {trend && (
        <div className="rounded-2xl bg-[#F4F4F2] p-2.5 sm:p-3">{trend}</div>
      )}
      {hasClients && clients}
    </div>
  );
  const panel = (k: Tab) => (k === "combos" ? combos : ventas);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 px-4 pt-3 sm:px-5 sm:pt-4">
        {/* Pestañas: en celular incluyen "Resumen"; en computadora el resumen está siempre a la izquierda. */}
        <div
          role="tablist"
          aria-label="Información del producto"
          className={`pvx-scroll-x flex min-w-0 gap-1 overflow-x-auto rounded-full bg-[#F4F4F2] p-1 ${tabs.length <= 2 ? "lg:invisible" : ""}`}
        >
          {tabs.map(([k, text]) => {
            const onDesktop = k === right;
            return (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={k === tab}
                onClick={() => setTab(k)}
                className={`pvx-press shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] min-[400px]:px-3.5 font-bold cursor-pointer ${k === "resumen" ? "lg:hidden" : ""} ${
                  k === tab
                    ? "bg-[#111214] text-white"
                    : "text-[#111214] hover:bg-[#E9E9E6]"
                } ${onDesktop && k !== tab ? "lg:bg-[#111214] lg:text-white lg:hover:bg-[#111214]" : ""}`}
              >
                {k === "ventas" && hasTrend && hasClients ? (
                  <>
                    <span className="min-[420px]:hidden">Ventas</span>
                    <span className="hidden min-[420px]:inline">{text}</span>
                  </>
                ) : (
                  text
                )}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="pvx-press grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#F4F4F2] text-[#111214] hover:bg-[#E9E9E6] cursor-pointer"
        >
          <IconClose className="w-5 h-5" />
        </button>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:pt-4">
        <div
          className={`min-h-0 overflow-y-auto overscroll-contain ${tab === "resumen" ? "" : "hidden"} lg:block`}
        >
          {summary}
        </div>
        <div
          className={`min-h-0 overflow-y-auto overscroll-contain ${tab === "resumen" ? "hidden lg:block" : ""}`}
        >
          {/* En celular: la pestaña elegida. En computadora: la de la derecha. */}
          <div className="lg:hidden">{panel(tab)}</div>
          <div className="hidden lg:block">{panel(right)}</div>
          <p className="mt-2 hidden text-[10.5px] text-[#6B717B] min-[400px]:block">
            Datos reales de despacho de nuestras bodegas, en rangos.
          </p>
        </div>
      </div>
    </div>
  );
}
