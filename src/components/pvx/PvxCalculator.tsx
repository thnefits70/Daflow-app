"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PublicCard } from "@/lib/provedixPublic";
import type { SnapshotProduct } from "@/lib/provedixSnapshot";
import {
  CALC_DEFAULTS,
  calcAtPrice,
  calcProfit,
  funnel,
  type CalcInput,
  type CalcStatus,
} from "@/lib/pvxCalc";
import { IconExternal, IconLock } from "@/components/pvx/PvxIcons";
import { PVX_SHARE_URLS, PvxShare } from "@/components/pvx/PvxShare";
import { PvxCalcDemo } from "@/components/pvx/PvxCalcDemo";

// Calculadora de ganancia de provedix.com (pedido del usuario 2026-10-15,
// basada en la calculadora ECOMX que mandó; fórmulas en src/lib/pvxCalc.ts).
// Libre para todos; el % real de entrega, las unidades por pedido y el precio
// de mercado del producto principal solo con registro. El precio de Dropi lo
// escribe el dropshipper (enlace "Ver en Dropi"): el actualizado siempre es
// el de Dropi. Combos (2026-10-15): varias unidades del mismo producto
// (x2, x3) o varios productos distintos en un mismo pedido — se suma el costo
// de todos y cuenta como un solo pedido con un solo flete. Los cálculos
// guardados viven en este navegador.

export const PVX_CALC_EVENT = "pvx-calc";
const SAVED_KEY = "pvx-calc-saved";
const MAX_LINES = 5;

type Line = {
  id: number;
  code: string | null;
  cost: string;
  qty: string;
  custom?: boolean;
};
type CostKey =
  "freight" | "cpa" | "admin" | "profit" | "cancelPct" | "returnPct";
type Saved = {
  id: string;
  name: string;
  lines: Line[];
  costs: Record<CostKey, string>;
  price: number;
  status: CalcStatus;
  organic?: boolean;
};
type Market = { price: number; units: number; share: number };
type Picked = { code: string; deliveryRate: number | null; market: Market[] };

const money = (n: number) =>
  `$${n.toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;
const num = (s: string) => {
  const v = Number(s.replace(",", ".").replace(/[^\d.]/g, ""));
  return Number.isFinite(v) ? v : 0;
};
const qtyOf = (l: Line) => Math.max(1, Math.round(num(l.qty)) || 1);

const STATUS: Record<CalcStatus, { label: string; text: string; cls: string }> =
  {
    RENTABLE: {
      label: "🟢 Rentable",
      text: "Tienes espacio para escalar tus anuncios.",
      cls: "bg-[#e3f6ea] text-[#0f7239]",
    },
    EN_ALERTA: {
      label: "🟡 En alerta",
      text: "El margen es pequeño: cuida tu CPA o sube el precio.",
      cls: "bg-[#fff4d6] text-[#7a5600]",
    },
    NO_RENTABLE: {
      label: "🔴 No rentable",
      text: "Tu CPA supera el máximo: estarías perdiendo dinero.",
      cls: "bg-[#fde8e6] text-[#a12a1f]",
    },
  };

const DEFAULT_COSTS: Record<CostKey, string> = {
  freight: String(CALC_DEFAULTS.freight),
  cpa: String(CALC_DEFAULTS.cpa),
  admin: String(CALC_DEFAULTS.admin),
  profit: String(CALC_DEFAULTS.profit),
  cancelPct: String(CALC_DEFAULTS.cancelPct),
  returnPct: String(CALC_DEFAULTS.returnPct),
};

// Cálculos guardados antes de los combos ({ code, input: {units, unitCost,…} }) se convierten.
function readSaved(): Saved[] {
  try {
    const v = JSON.parse(localStorage.getItem(SAVED_KEY) ?? "[]");
    if (!Array.isArray(v)) return [];
    return v.slice(0, 30).map((s) =>
      s.lines
        ? s
        : {
            id: s.id,
            name: s.name,
            price: s.price,
            status: s.status,
            lines: [
              {
                id: 1,
                code: s.code ?? null,
                cost: String(s.input?.unitCost ?? ""),
                qty: String(s.input?.units ?? 1),
              },
            ],
            costs: Object.fromEntries(
              Object.keys(DEFAULT_COSTS).map((k) => [
                k,
                String(s.input?.[k] ?? DEFAULT_COSTS[k as CostKey]),
              ]),
            ) as Record<CostKey, string>,
          },
    );
  } catch {
    return [];
  }
}
function writeSaved(list: Saved[]) {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(list.slice(0, 30)));
  } catch {
    // sin almacenamiento: igual se puede calcular
  }
}

function Field({
  label,
  hint,
  value,
  onChange,
  prefix,
  suffix,
  children,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  prefix?: string;
  suffix?: string;
  children?: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="flex items-center justify-between gap-2 text-[13px] font-bold">
        {label}
        {children}
      </span>
      <span className="mt-1.5 flex items-center rounded-2xl bg-white px-3.5 ring-1 ring-[var(--pvx-paper-3)] focus-within:ring-2 focus-within:ring-[var(--pvx-orange)]">
        {prefix && <span className="text-[var(--pvx-ink-3)]">{prefix}</span>}
        <input
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="pvx-noring pvx-num min-h-[46px] w-full bg-transparent px-1.5 text-[17px] font-bold outline-none"
        />
        {suffix && <span className="text-[var(--pvx-ink-3)]">{suffix}</span>}
      </span>
      {hint && (
        <span className="mt-1 block text-[11.5px] text-[var(--pvx-ink-3)]">
          {hint}
        </span>
      )}
    </label>
  );
}

// Buscar un producto de Provedix por nombre o ID (opcional en cada línea).
function ProductPicker({
  cards,
  code,
  onPick,
  label,
}: {
  cards: PublicCard[];
  code: string | null;
  onPick: (code: string | null) => void;
  label: string;
}) {
  const [query, setQuery] = useState("");
  const card = code ? cards.find((c) => c.code === code) : null;
  const q = query.trim().toLowerCase();
  const options =
    q.length >= 2
      ? cards
          .filter((c) => c.code.includes(q) || c.name.toLowerCase().includes(q))
          .slice(0, 6)
      : [];
  if (card)
    return (
      <div className="flex items-center justify-between gap-2 rounded-2xl bg-white px-3.5 py-2.5 ring-1 ring-[var(--pvx-paper-3)]">
        <span className="min-w-0">
          <span className="block truncate text-[14.5px] font-bold">
            {card.name}
          </span>
          <span className="pvx-num text-[12px] text-[var(--pvx-ink-3)]">
            ID {card.code}
          </span>
        </span>
        <button
          type="button"
          onClick={() => onPick(null)}
          className="shrink-0 text-[12.5px] font-bold text-[var(--pvx-ink-2)] hover:underline cursor-pointer"
        >
          Cambiar
        </button>
      </div>
    );
  return (
    <div className="relative">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Busca por nombre o ID de Dropi (opcional)…"
        aria-label={label}
        className="pvx-noring min-h-[46px] w-full rounded-2xl bg-white px-3.5 text-[16px] outline-none ring-1 ring-[var(--pvx-paper-3)] focus:ring-2 focus:ring-[var(--pvx-orange)]"
      />
      {options.length > 0 && (
        <div className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-2xl bg-white shadow-[0_18px_44px_-14px_rgb(0_0_0/0.35)] ring-1 ring-[var(--pvx-paper-3)]">
          {options.map((c) => (
            <button
              key={c.code}
              type="button"
              onClick={() => (onPick(c.code), setQuery(""))}
              className="block w-full px-3.5 py-2.5 text-left hover:bg-[var(--pvx-paper-2)] cursor-pointer"
            >
              <span className="block truncate text-[14px] font-semibold">
                {c.name}
              </span>
              <span className="pvx-num text-[12px] text-[var(--pvx-ink-3)]">
                ID {c.code}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function PvxCalculator({
  cards,
  registered,
  onRegister,
}: {
  cards: PublicCard[];
  registered: boolean;
  onRegister: () => void;
}) {
  const [lines, setLines] = useState<Line[]>([
    { id: 1, code: null, cost: "", qty: "1" },
  ]);
  const [costs, setCosts] = useState<Record<CostKey, string>>(DEFAULT_COSTS);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [loading, setLoading] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  // Ventas orgánicas (2026-10-15): sin pauta no hay CPA — un cancelado no
  // cuesta nada y un devuelto solo el flete.
  const [organic, setOrganic] = useState(false);
  const [perDay, setPerDay] = useState("10");
  const [saved, setSaved] = useState<Saved[]>([]);
  const ref = useRef<HTMLElement>(null);
  const nextId = useRef(2);

  useEffect(() => {
    const t = setTimeout(() => setSaved(readSaved()), 0);
    return () => clearTimeout(t);
  }, []);

  const setCost = (k: CostKey) => (v: string) =>
    setCosts((c) => ({ ...c, [k]: v }));
  const setLine = (id: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const first = lines[0];
  const isCombo = lines.length > 1;
  const comboCost = lines.reduce((s, l) => s + qtyOf(l) * num(l.cost), 0);
  const allPriced = lines.every((l) => num(l.cost) > 0);

  // Un pedido = todos los productos de las líneas, con un solo flete.
  const input: CalcInput = useMemo(
    () => ({
      units: 1,
      unitCost: allPriced ? comboCost : 0,
      freight: num(costs.freight),
      cpa: organic ? 0 : num(costs.cpa),
      admin: num(costs.admin),
      profit: num(costs.profit),
      cancelPct: num(costs.cancelPct),
      returnPct: num(costs.returnPct),
    }),
    [costs, comboCost, allPriced, organic],
  );
  const res = calcProfit(input);
  const f = funnel(input);
  const mainCard = first.code ? cards.find((c) => c.code === first.code) : null;
  // Precio de mercado: solo si es un producto (suelto o x2/x3), no un combo de varios.
  const market =
    !isCombo && picked?.code === first.code
      ? (picked.market.find((m) => m.units === qtyOf(first)) ?? null)
      : null;
  const atMarket = market ? calcAtPrice(input, market.price) : null;

  // Producto principal: con registro trae el % real de entrega, las unidades
  // más comunes y el precio de mercado (la ficha completa).
  const mainCode = first.code;
  useEffect(() => {
    if (!mainCode || !registered) return;
    let alive = true;
    const t = setTimeout(() => setLoading(true), 0);
    fetch(`/api/pvx/product/${encodeURIComponent(mainCode)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { product?: SnapshotProduct } | null) => {
        const p = d?.product;
        if (!alive || !p?.code) return;
        const mix = p.qtyMix;
        const units = mix
          ? mix.two > mix.one && mix.two >= mix.threePlus
            ? 2
            : mix.threePlus > mix.one && mix.threePlus > mix.two
              ? 3
              : 1
          : 1;
        setPicked({
          code: p.code,
          deliveryRate: p.deliveryRate,
          market: p.offers.map((o) => ({
            price: o.price,
            units: o.units,
            share: o.share,
          })),
        });
        setLines((ls) =>
          ls.map((l, i) => (i === 0 ? { ...l, qty: String(units) } : l)),
        );
        if (p.deliveryRate != null)
          setCosts((c) => ({
            ...c,
            returnPct: String(Math.max(0, 100 - p.deliveryRate!)),
          }));
      })
      .catch(() => null)
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [mainCode, registered]);

  // "Calcular mi ganancia" desde la ficha o desde el chat de Michelle IA.
  useEffect(() => {
    const onPick = (e: Event) => {
      const code = (e as CustomEvent<string>).detail;
      if (!code) return;
      setLines([{ id: 1, code, cost: "", qty: "1" }]);
      setPicked(null);
      ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    window.addEventListener(PVX_CALC_EVENT, onPick);
    return () => window.removeEventListener(PVX_CALC_EVENT, onPick);
  }, []);

  // Entró por el enlace compartido provedix.com/calculadora: va directo aquí.
  useEffect(() => {
    if (window.location.pathname !== "/calculadora") return;
    const t = setTimeout(
      () => ref.current?.scrollIntoView({ block: "start" }),
      300,
    );
    return () => clearTimeout(t);
  }, []);

  const day = Math.max(0, num(perDay));
  const dailyProfit = res
    ? day * res.deliveredRate * res.profitPerDelivered
    : 0;

  function addLine() {
    if (lines.length >= MAX_LINES) return;
    setLines((ls) => [
      ...ls,
      { id: nextId.current++, code: null, cost: "", qty: "1" },
    ]);
  }
  function removeLine(id: number) {
    setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.id !== id) : ls));
  }
  function nameOf(ls: Line[]) {
    const names = ls
      .map((l) =>
        l.code
          ? (cards.find((c) => c.code === l.code)?.name ?? `ID ${l.code}`)
          : "Producto",
      )
      .map((n, i) => (qtyOf(ls[i]) > 1 ? `${n} x${qtyOf(ls[i])}` : n));
    return ls.length > 1
      ? `Combo: ${names.join(" + ")}`
      : names[0] === "Producto"
        ? "Mi producto"
        : names[0];
  }
  function save() {
    if (!res) return;
    const item: Saved = {
      id: `${saved.length}-${res.price}-${comboCost}-${lines.length}`,
      name: organic ? `${nameOf(lines)} (orgánico)` : nameOf(lines),
      organic,
      lines,
      costs,
      price: res.price,
      status: res.status,
    };
    const list = [item, ...saved.filter((s) => s.name !== item.name)];
    setSaved(list);
    writeSaved(list);
  }
  function load(s: Saved) {
    setLines(s.lines.map((l, i) => ({ ...l, id: i + 1 })));
    nextId.current = s.lines.length + 1;
    setCosts({ ...DEFAULT_COSTS, ...s.costs });
    setOrganic(!!s.organic);
    setPicked(null);
  }
  function remove(id: string) {
    const list = saved.filter((s) => s.id !== id);
    setSaved(list);
    writeSaved(list);
  }

  return (
    <section
      ref={ref}
      id="calculadora"
      data-tour="calc"
      className="scroll-mt-4 bg-white py-24 sm:py-32"
      aria-labelledby="pvx-calc-title"
    >
      <div className="mx-auto max-w-[1240px] px-4 sm:px-8">
        <p className="text-[13px] font-bold uppercase tracking-[0.14em] text-[var(--pvx-orange-text)]">
          Herramienta gratis
        </p>
        <h2
          id="pvx-calc-title"
          className="pvx-display mt-3 max-w-[820px] text-[38px] sm:text-[60px]"
        >
          ¿A cuánto lo vendo para ganar?
        </h2>
        <p className="mt-3 max-w-2xl text-[16px] leading-relaxed text-[var(--pvx-ink-2)]">
          Pon tus números y te decimos el precio que cubre cancelaciones,
          devoluciones y publicidad, y cuánto puedes pagar de CPA sin perder.
          También para combos.
        </p>
        {/* Compartir la calculadora (2026-10-15): que más dropshippers conozcan provedix.com. */}
        <div className="mt-5">
          <PvxShare
            url={PVX_SHARE_URLS.calculadora}
            message="🧮 Calcula a cuánto vender tus productos para ganar, gratis en Provedix:"
          />
        </div>

        <div className="mt-10 grid gap-6 lg:grid-cols-[1.05fr_1fr]">
          {/* Datos */}
          <div className="rounded-[28px] bg-[var(--pvx-paper-2)] p-5 sm:p-7">
            {/* ¿Cómo vendes? Con pauta (Facebook/TikTok) u orgánico (sin pagar anuncios). */}
            <div className="mb-5">
              <p className="text-[13px] font-bold">¿Cómo vendes?</p>
              <div
                className="mt-1.5 grid grid-cols-2 gap-1 rounded-2xl bg-white p-1 ring-1 ring-[var(--pvx-paper-3)]"
                role="group"
                aria-label="Cómo vendes"
              >
                {[
                  [false, "Con pauta", "Pagas anuncios"],
                  [true, "Orgánico", "Sin pagar anuncios"],
                ].map(([v, t, s]) => (
                  <button
                    key={String(t)}
                    type="button"
                    onClick={() => setOrganic(v as boolean)}
                    aria-pressed={organic === v}
                    className={`pvx-press rounded-xl px-3 py-2 text-left cursor-pointer ${organic === v ? "bg-[var(--pvx-ink)] text-white" : "hover:bg-[var(--pvx-paper-2)]"}`}
                  >
                    <span className="block text-[14px] font-bold">
                      {t as string}
                    </span>
                    <span
                      className={`block text-[11.5px] ${organic === v ? "text-white/70" : "text-[var(--pvx-ink-3)]"}`}
                    >
                      {s as string}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <p className="text-[15px] font-bold">
              {isCombo ? `Tu combo (${lines.length} productos)` : "Tu producto"}
            </p>

            <div className="mt-3 space-y-4">
              {lines.map((l, i) => {
                const lineCard = l.code
                  ? cards.find((c) => c.code === l.code)
                  : null;
                return (
                  <div
                    key={l.id}
                    className={
                      isCombo
                        ? "rounded-2xl bg-white/60 p-3 ring-1 ring-[var(--pvx-paper-3)]"
                        : ""
                    }
                  >
                    {isCombo && (
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-[12.5px] font-bold text-[var(--pvx-ink-2)]">
                          Producto {i + 1}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeLine(l.id)}
                          className="text-[12.5px] font-bold text-[var(--pvx-ink-3)] hover:text-[var(--pvx-ink)] cursor-pointer"
                        >
                          Quitar
                        </button>
                      </div>
                    )}
                    <ProductPicker
                      cards={cards}
                      code={l.code}
                      label={`Buscar el producto ${i + 1} de Provedix`}
                      onPick={(code) => {
                        setLine(l.id, { code });
                        if (i === 0) setPicked(null);
                      }}
                    />
                    {i === 0 && lineCard && !registered && (
                      <button
                        type="button"
                        onClick={onRegister}
                        className="mt-2 flex w-full items-center gap-2 rounded-2xl bg-[var(--pvx-orange-soft)] px-3.5 py-2.5 text-left text-[12.5px] font-semibold cursor-pointer"
                      >
                        <IconLock className="w-4 h-4 shrink-0 text-[var(--pvx-orange-text)]" />
                        Regístrate gratis y usamos el % real de entrega de este
                        producto y el precio al que se vende en el mercado.
                      </button>
                    )}
                    {i === 0 && lineCard && registered && loading && (
                      <p className="mt-2 text-[12.5px] text-[var(--pvx-ink-3)]">
                        Trayendo los datos reales del producto…
                      </p>
                    )}
                    {i === 0 &&
                      picked?.code === l.code &&
                      picked.deliveryRate != null && (
                        <p className="mt-2 text-[12.5px] text-[#0f7239]">
                          ✓ Usamos el % real de entrega de este producto con
                          nuestros despachos: {picked.deliveryRate}%.
                        </p>
                      )}

                    <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
                      <Field
                        label="Precio en Dropi (por unidad)"
                        prefix="$"
                        value={l.cost}
                        onChange={(v) => setLine(l.id, { cost: v })}
                        hint={
                          i === 0 && !isCombo
                            ? "El que pagas tú al proveedor."
                            : undefined
                        }
                      >
                        {lineCard && (
                          <a
                            href={`/api/pvx/go/dropi/${lineCard.code}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[12px] font-bold text-[var(--pvx-orange-text)] hover:underline"
                          >
                            Ver en Dropi <IconExternal className="w-3 h-3" />
                          </a>
                        )}
                      </Field>
                      {/* Cantidad: suelto o combo del mismo producto (x2, x3) */}
                      <div>
                        <span className="text-[13px] font-bold">Unidades</span>
                        <div
                          className="mt-1.5 flex gap-1.5"
                          role="group"
                          aria-label={`Unidades del producto ${i + 1}`}
                        >
                          {["1", "2", "3"].map((n) => (
                            <button
                              key={n}
                              type="button"
                              onClick={() =>
                                setLine(l.id, { qty: n, custom: false })
                              }
                              aria-pressed={!l.custom && String(qtyOf(l)) === n}
                              className={`pvx-press min-h-[46px] rounded-2xl px-3.5 text-[14px] font-bold cursor-pointer ${!l.custom && String(qtyOf(l)) === n ? "bg-[var(--pvx-ink)] text-white" : "bg-white ring-1 ring-[var(--pvx-paper-3)] hover:ring-[var(--pvx-orange)]"}`}
                            >
                              {n === "1" ? "1" : `x${n}`}
                            </button>
                          ))}
                          <input
                            inputMode="numeric"
                            value={
                              l.custom || !["1", "2", "3"].includes(l.qty)
                                ? l.qty
                                : ""
                            }
                            onChange={(e) =>
                              setLine(l.id, {
                                qty: e.target.value,
                                custom: true,
                              })
                            }
                            placeholder="+"
                            aria-label={`Otra cantidad del producto ${i + 1}`}
                            className="pvx-noring pvx-num min-h-[46px] w-14 rounded-2xl bg-white text-center text-[15px] font-bold outline-none ring-1 ring-[var(--pvx-paper-3)] focus:ring-2 focus:ring-[var(--pvx-orange)]"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {lines.length < MAX_LINES && (
              <button
                type="button"
                onClick={addLine}
                className="pvx-press mt-3 w-full rounded-2xl border-2 border-dashed border-[var(--pvx-paper-3)] px-4 py-3 text-[14px] font-bold text-[var(--pvx-ink-2)] hover:border-[var(--pvx-orange)] hover:text-[var(--pvx-ink)] cursor-pointer"
              >
                + Agregar otro producto al combo
              </button>
            )}
            {(isCombo || qtyOf(first) > 1) && allPriced && (
              <p className="mt-3 rounded-2xl bg-white px-3.5 py-2.5 text-[13px]">
                Costo de tu {isCombo ? "combo" : `pedido x${qtyOf(first)}`} en
                Dropi: <b className="pvx-num">{money(comboCost)}</b> · un solo
                flete por pedido
              </p>
            )}

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Field
                label="Flete por pedido"
                prefix="$"
                value={costs.freight}
                onChange={setCost("freight")}
                hint="Promedio en Ecuador: $7. Si solo envías a ciudades grandes, baja."
              />
              {!organic && (
                <Field
                  label="CPA (publicidad por pedido)"
                  prefix="$"
                  value={costs.cpa}
                  onChange={setCost("cpa")}
                  hint="Lo que te cobra Facebook/TikTok por pedido. Promedio: $4–5."
                />
              )}
              <Field
                label="Ganancia que quieres por pedido"
                prefix="$"
                value={costs.profit}
                onChange={setCost("profit")}
              />
            </div>

            <button
              type="button"
              onClick={() => setAdvanced(!advanced)}
              aria-expanded={advanced}
              className="mt-5 text-[13px] font-bold text-[var(--pvx-ink-2)] hover:underline cursor-pointer"
            >
              {advanced
                ? "− Ocultar opciones avanzadas"
                : "+ Opciones avanzadas (cancelaciones, devoluciones, gastos)"}
            </button>
            {advanced && (
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <Field
                  label="% cancelaciones"
                  suffix="%"
                  value={costs.cancelPct}
                  onChange={setCost("cancelPct")}
                  hint="Pedidos que no confirmas."
                />
                <Field
                  label="% devoluciones"
                  suffix="%"
                  value={costs.returnPct}
                  onChange={setCost("returnPct")}
                  hint="Enviados que regresan."
                />
                <Field
                  label="Gastos por pedido"
                  prefix="$"
                  value={costs.admin}
                  onChange={setCost("admin")}
                  hint="Arriendo, sueldos, Shopify… ÷ pedidos."
                />
              </div>
            )}
          </div>

          {/* Resultados */}
          <div
            className="rounded-[28px] bg-[var(--pvx-night)] p-5 text-white sm:p-7"
            aria-live="polite"
          >
            {!res ? (
              // "Video" animado de cómo se usa (2026-10-15), mientras no escribe nada.
              <PvxCalcDemo
                onTry={() => {
                  setLines([{ id: 1, code: null, cost: "5", qty: "1" }]);
                  setCosts(DEFAULT_COSTS);
                }}
              />
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[13px] font-semibold text-white/60">
                      Precio recomendado al público
                      {isCombo
                        ? " (combo)"
                        : qtyOf(first) > 1
                          ? ` (x${qtyOf(first)})`
                          : ""}
                    </p>
                    <p className="pvx-display pvx-num mt-1 text-[56px] leading-none text-[var(--pvx-orange)] sm:text-[64px]">
                      {money(res.price)}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-3 py-1 text-[12.5px] font-bold ${STATUS[res.status].cls}`}
                  >
                    {STATUS[res.status].label}
                  </span>
                </div>
                <p className="mt-2 text-[13.5px] text-white/70">
                  {organic
                    ? res.status === "NO_RENTABLE"
                      ? "A ese precio pierdes dinero en cada pedido."
                      : "Vendiendo orgánico, sin pagar anuncios: cancelados no te cuestan nada y devueltos solo el flete."
                    : STATUS[res.status].text}
                </p>

                <div className="mt-6 grid grid-cols-2 gap-3">
                  {[
                    ["Precio mínimo (sin ganancia)", money(res.minPrice)],
                    // Orgánico: lo que podría pagar de pauta si un día decide anunciar.
                    [
                      organic
                        ? "Si un día pautas, CPA máximo"
                        : "CPA máximo sin perder",
                      money(res.breakEvenCpa),
                    ],
                    [
                      "Ganancia por pedido entregado",
                      money(res.profitPerDelivered),
                    ],
                    ["Margen", pct(res.margin)],
                  ].map(([k, v]) => (
                    <div
                      key={k}
                      className="rounded-2xl bg-white/[0.06] px-3.5 py-3"
                    >
                      <p className="text-[11.5px] text-white/60">{k}</p>
                      <p className="pvx-num mt-0.5 text-[20px] font-bold">
                        {v}
                      </p>
                    </div>
                  ))}
                </div>
                {!organic && res.cpaRoom >= 0 && (
                  <p className="mt-3 text-[12.5px] text-white/70">
                    Te quedan <b className="text-white">{money(res.cpaRoom)}</b>{" "}
                    de espacio en el CPA para escalar.
                  </p>
                )}

                {market && atMarket && mainCard && (
                  <div className="mt-5 rounded-2xl bg-white/[0.06] px-4 py-3.5">
                    <p className="text-[12.5px] text-white/60">
                      Hoy el mercado lo vende a{" "}
                      <b className="text-white">{money(market.price)}</b>
                      {market.units > 1
                        ? ` por ${market.units} unidades`
                        : ""}{" "}
                      ({market.share}% de los pedidos)
                    </p>
                    <p className="mt-1 text-[14px]">
                      Con tus números a ese precio:{" "}
                      <b
                        className={
                          atMarket.profitPerDelivered >= 0
                            ? "text-[#7be3a3]"
                            : "text-[#ff9b8f]"
                        }
                      >
                        {atMarket.profitPerDelivered >= 0 ? "ganas" : "pierdes"}{" "}
                        {money(Math.abs(atMarket.profitPerDelivered))} por
                        pedido entregado
                      </b>{" "}
                      · {STATUS[atMarket.status].label}
                    </p>
                  </div>
                )}

                {/* Embudo de 100 pedidos */}
                <div className="mt-6">
                  <p className="text-[12.5px] font-semibold text-white/60">
                    De cada 100 pedidos que generas
                  </p>
                  <div className="mt-2 grid grid-cols-4 gap-1.5 text-center">
                    {[
                      [f.generated, "generados", ""],
                      [
                        f.cancelled,
                        "cancelados",
                        organic ? "no pierdes nada" : "pierdes el CPA",
                      ],
                      [
                        f.returned,
                        "devueltos",
                        organic ? "pierdes el flete" : "CPA + flete",
                      ],
                      [f.delivered, "entregados", "aquí ganas"],
                    ].map(([n, l, s], i) => (
                      <div
                        key={String(l)}
                        className={`rounded-xl px-1 py-2 ${i === 3 ? "bg-[var(--pvx-orange)]" : "bg-white/[0.06]"}`}
                      >
                        <p className="pvx-num text-[20px] font-bold">{n}</p>
                        <p className="text-[11px] text-white/80">{l}</p>
                        {s && <p className="text-[10px] text-white/60">{s}</p>}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Metas */}
                <div className="mt-6 flex flex-wrap items-center gap-2 text-[13.5px]">
                  Si generas
                  <input
                    inputMode="numeric"
                    value={perDay}
                    onChange={(e) => setPerDay(e.target.value)}
                    aria-label="Pedidos generados al día"
                    className="pvx-noring pvx-num w-16 rounded-xl bg-white/10 px-2 py-1 text-center font-bold outline-none focus:ring-2 focus:ring-[var(--pvx-orange)]"
                  />
                  pedidos al día:
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {[
                    ["al día", dailyProfit],
                    ["a la semana", dailyProfit * 7],
                    ["al mes", dailyProfit * 30],
                  ].map(([k, v]) => (
                    <div
                      key={String(k)}
                      className="rounded-2xl bg-white/[0.06] px-3 py-2.5"
                    >
                      <p className="pvx-num text-[18px] font-bold">
                        {money(Number(v))}
                      </p>
                      <p className="text-[11.5px] text-white/60">
                        ganancia {k}
                      </p>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={save}
                  className="pvx-press mt-6 w-full rounded-full bg-white px-4 py-3 text-[14.5px] font-bold text-[var(--pvx-ink)] hover:bg-[var(--pvx-orange-soft)] cursor-pointer"
                >
                  Guardar en mis cálculos
                </button>
              </>
            )}
          </div>
        </div>

        {saved.length > 0 && (
          <div className="mt-8">
            <p className="text-[14px] font-bold">
              Mis cálculos (en este navegador)
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {saved.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center gap-3 rounded-2xl bg-[var(--pvx-paper-2)] px-4 py-3"
                >
                  <button
                    type="button"
                    onClick={() => load(s)}
                    className="min-w-0 flex-1 text-left cursor-pointer"
                  >
                    <span className="block truncate text-[14px] font-bold">
                      {s.name}
                    </span>
                    <span className="text-[12.5px] text-[var(--pvx-ink-2)]">
                      <span className="pvx-num">{money(s.price)}</span> ·{" "}
                      {STATUS[s.status].label}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(s.id)}
                    aria-label={`Borrar el cálculo de ${s.name}`}
                    className="text-[18px] leading-none text-[var(--pvx-ink-3)] hover:text-[var(--pvx-ink)] cursor-pointer"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        <p className="mt-6 text-[12px] text-[var(--pvx-ink-3)]">
          Es una estimación con los límites que pones: tus resultados reales
          pueden ser mejores. Prueba con campañas pequeñas antes de escalar.
        </p>
      </div>
    </section>
  );
}
