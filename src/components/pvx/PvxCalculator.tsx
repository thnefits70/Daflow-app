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

// Calculadora de ganancia de provedix.com (pedido del usuario 2026-10-15,
// basada en la calculadora ECOMX que mandó; fórmulas en src/lib/pvxCalc.ts).
// Libre para todos; el % real de entrega, las unidades por pedido y el precio
// de mercado de cada producto solo con registro. El precio de Dropi lo
// escribe el dropshipper (botón "Ver precio en Dropi"): el actualizado siempre
// es el de Dropi. Los cálculos guardados viven en este navegador.

export const PVX_CALC_EVENT = "pvx-calc";
const SAVED_KEY = "pvx-calc-saved";

type Saved = {
  id: string;
  code: string | null;
  name: string;
  input: CalcInput;
  price: number;
  status: CalcStatus;
};
type Market = { price: number; units: number; share: number };
type Picked = {
  code: string;
  name: string;
  deliveryRate: number | null;
  market: Market[];
};

const money = (n: number) =>
  `$${n.toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;
const num = (s: string) => {
  const v = Number(s.replace(",", ".").replace(/[^\d.]/g, ""));
  return Number.isFinite(v) ? v : 0;
};

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

function readSaved(): Saved[] {
  try {
    const v = JSON.parse(localStorage.getItem(SAVED_KEY) ?? "[]");
    return Array.isArray(v) ? v.slice(0, 30) : [];
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
          className="pvx-num min-h-[46px] w-full bg-transparent px-1.5 text-[17px] font-bold outline-none"
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

export function PvxCalculator({
  cards,
  registered,
  onRegister,
}: {
  cards: PublicCard[];
  registered: boolean;
  onRegister: () => void;
}) {
  const [form, setForm] = useState<Record<keyof CalcInput, string>>(
    () =>
      Object.fromEntries(
        Object.entries(CALC_DEFAULTS).map(([k, v]) => [
          k,
          k === "unitCost" ? "" : String(v),
        ]),
      ) as Record<keyof CalcInput, string>,
  );
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Picked | null>(null);
  const [pickedCode, setPickedCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [perDay, setPerDay] = useState("10");
  const [saved, setSaved] = useState<Saved[]>([]);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setSaved(readSaved()), 0);
    return () => clearTimeout(t);
  }, []);

  const set = (k: keyof CalcInput) => (v: string) =>
    setForm((f) => ({ ...f, [k]: v }));
  const input: CalcInput = useMemo(
    () => ({
      units: Math.max(1, Math.round(num(form.units)) || 1),
      unitCost: num(form.unitCost),
      freight: num(form.freight),
      cpa: num(form.cpa),
      admin: num(form.admin),
      profit: num(form.profit),
      cancelPct: num(form.cancelPct),
      returnPct: num(form.returnPct),
    }),
    [form],
  );
  const res = calcProfit(input);
  const f = funnel(input);
  const card = pickedCode ? cards.find((c) => c.code === pickedCode) : null;
  const market = picked?.market.find((m) => m.units === input.units) ?? null;
  const atMarket = market ? calcAtPrice(input, market.price) : null;

  // Producto elegido: con registro trae el % real de entrega, las unidades
  // más comunes y el precio de mercado (la ficha completa).
  useEffect(() => {
    if (!pickedCode || !registered) return;
    let alive = true;
    const t = setTimeout(() => setLoading(true), 0);
    fetch(`/api/pvx/product/${encodeURIComponent(pickedCode)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { product?: SnapshotProduct } | SnapshotProduct | null) => {
        if (!alive || !d) return;
        const p = ("product" in d ? d.product : d) as
          SnapshotProduct | undefined;
        if (!p?.code) return;
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
          name: p.name,
          deliveryRate: p.deliveryRate,
          market: p.offers.map((o) => ({
            price: o.price,
            units: o.units,
            share: o.share,
          })),
        });
        setForm((fm) => ({
          ...fm,
          units: String(units),
          ...(p.deliveryRate != null
            ? { returnPct: String(Math.max(0, 100 - p.deliveryRate)) }
            : {}),
        }));
      })
      .catch(() => null)
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [pickedCode, registered]);

  // "Calcular mi ganancia" desde la ficha o desde el chat de Michelle IA.
  useEffect(() => {
    const onPick = (e: Event) => {
      const code = (e as CustomEvent<string>).detail;
      if (!code) return;
      setPickedCode(code);
      setPicked(null);
      setQuery("");
      ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    window.addEventListener(PVX_CALC_EVENT, onPick);
    return () => window.removeEventListener(PVX_CALC_EVENT, onPick);
  }, []);

  const q = query.trim().toLowerCase();
  const options =
    q.length >= 2
      ? cards
          .filter((c) => c.code.includes(q) || c.name.toLowerCase().includes(q))
          .slice(0, 6)
      : [];
  const day = Math.max(0, num(perDay));
  const dailyProfit = res
    ? day * res.deliveredRate * res.profitPerDelivered
    : 0;

  function save() {
    if (!res) return;
    const item: Saved = {
      id: `${card?.code ?? "mio"}-${saved.length}-${res.price}-${input.unitCost}`,
      code: card?.code ?? null,
      name: card?.name ?? "Mi producto",
      input,
      price: res.price,
      status: res.status,
    };
    const list = [
      item,
      ...saved.filter((s) => !(s.code && s.code === item.code)),
    ];
    setSaved(list);
    writeSaved(list);
  }
  function load(s: Saved) {
    setForm(
      Object.fromEntries(
        Object.entries(s.input).map(([k, v]) => [k, String(v)]),
      ) as Record<keyof CalcInput, string>,
    );
    setPickedCode(s.code);
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
        </p>

        <div className="mt-10 grid gap-6 lg:grid-cols-[1.05fr_1fr]">
          {/* Datos */}
          <div className="rounded-[28px] bg-[var(--pvx-paper-2)] p-5 sm:p-7">
            <div className="relative">
              <span className="text-[13px] font-bold">
                Producto de Provedix (opcional)
              </span>
              {card ? (
                <div className="mt-1.5 flex items-center justify-between gap-2 rounded-2xl bg-white px-3.5 py-2.5 ring-1 ring-[var(--pvx-paper-3)]">
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
                    onClick={() => (setPickedCode(null), setPicked(null))}
                    className="text-[12.5px] font-bold text-[var(--pvx-ink-2)] hover:underline cursor-pointer"
                  >
                    Cambiar
                  </button>
                </div>
              ) : (
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Busca por nombre o ID de Dropi…"
                  aria-label="Buscar un producto de Provedix"
                  className="mt-1.5 min-h-[46px] w-full rounded-2xl bg-white px-3.5 text-[16px] outline-none ring-1 ring-[var(--pvx-paper-3)] focus:ring-2 focus:ring-[var(--pvx-orange)]"
                />
              )}
              {options.length > 0 && !card && (
                <div className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-2xl bg-white shadow-[0_18px_44px_-14px_rgb(0_0_0/0.35)] ring-1 ring-[var(--pvx-paper-3)]">
                  {options.map((c) => (
                    <button
                      key={c.code}
                      type="button"
                      onClick={() => (
                        setPickedCode(c.code),
                        setPicked(null),
                        setQuery("")
                      )}
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
              {card && !registered && (
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
              {card && registered && loading && (
                <p className="mt-2 text-[12.5px] text-[var(--pvx-ink-3)]">
                  Trayendo los datos reales del producto…
                </p>
              )}
              {picked && picked.deliveryRate != null && (
                <p className="mt-2 text-[12.5px] text-[#0f7239]">
                  ✓ Usamos el % real de entrega de este producto con nuestros
                  despachos: {picked.deliveryRate}%.
                </p>
              )}
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Field
                label="Precio en Dropi (por unidad)"
                prefix="$"
                value={form.unitCost}
                onChange={set("unitCost")}
                hint="El que pagas tú al proveedor."
              >
                {card && (
                  <a
                    href={`/api/pvx/go/dropi/${card.code}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[12px] font-bold text-[var(--pvx-orange-text)] hover:underline"
                  >
                    Ver en Dropi <IconExternal className="w-3 h-3" />
                  </a>
                )}
              </Field>
              <Field
                label="Unidades por pedido"
                value={form.units}
                onChange={set("units")}
                hint="Del mismo producto en un pedido."
              />
              <Field
                label="Flete por pedido"
                prefix="$"
                value={form.freight}
                onChange={set("freight")}
                hint="Promedio en Ecuador: $7. Si solo envías a ciudades grandes, baja."
              />
              <Field
                label="CPA (publicidad por pedido)"
                prefix="$"
                value={form.cpa}
                onChange={set("cpa")}
                hint="Lo que te cobra Facebook/TikTok por pedido. Promedio: $4–5."
              />
              <Field
                label="Ganancia que quieres por pedido"
                prefix="$"
                value={form.profit}
                onChange={set("profit")}
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
                  value={form.cancelPct}
                  onChange={set("cancelPct")}
                  hint="Pedidos que no confirmas."
                />
                <Field
                  label="% devoluciones"
                  suffix="%"
                  value={form.returnPct}
                  onChange={set("returnPct")}
                  hint="Enviados que regresan."
                />
                <Field
                  label="Gastos por pedido"
                  prefix="$"
                  value={form.admin}
                  onChange={set("admin")}
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
              <div className="grid h-full min-h-[280px] place-items-center text-center text-white/70">
                <p className="max-w-xs text-[15px]">
                  Escribe el precio en Dropi del producto y te mostramos a
                  cuánto venderlo. 👈
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[13px] font-semibold text-white/60">
                      Precio recomendado al público
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
                  {STATUS[res.status].text}
                </p>

                <div className="mt-6 grid grid-cols-2 gap-3">
                  {[
                    ["Precio mínimo (sin ganancia)", money(res.minPrice)],
                    ["CPA máximo sin perder", money(res.breakEvenCpa)],
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
                {res.cpaRoom >= 0 && (
                  <p className="mt-3 text-[12.5px] text-white/70">
                    Te quedan <b className="text-white">{money(res.cpaRoom)}</b>{" "}
                    de espacio en el CPA para escalar.
                  </p>
                )}

                {market && atMarket && (
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
                      [f.cancelled, "cancelados", "pierdes el CPA"],
                      [f.returned, "devueltos", "CPA + flete"],
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
                    className="pvx-num w-16 rounded-xl bg-white/10 px-2 py-1 text-center font-bold outline-none focus:ring-2 focus:ring-[var(--pvx-orange)]"
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
