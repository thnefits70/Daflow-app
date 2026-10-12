"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PublicCard } from "@/lib/provedixPublic";
import type { SnapshotProduct } from "@/lib/provedixSnapshot";
import { PvxPhoto } from "@/components/pvx/PvxPhoto";
import { PvxRegister } from "@/components/pvx/PvxRegister";
import { CopyId, PvxProductDetail } from "@/components/pvx/PvxProductDetail";

const BRAND = { MKT_PROVEDIX: "Provedix", MKT_DAMIAN: "Importadora Damián" } as const;
type BrandFilter = "ALL" | keyof typeof BRAND;
const PAGE = 24;

function norm(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function dayLabel(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

// Página pública de provedix.com (etapa 3, pedido del usuario 2026-10-12):
// catálogo de los productos que más se venden de nuestras bodegas. Ver la
// ficha completa pide registrarse una vez (nombre + WhatsApp).
export function PvxCatalog({ cards, windowTo }: { cards: PublicCard[]; windowTo: string | null }) {
  const [registered, setRegistered] = useState<boolean | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [brand, setBrand] = useState<BrandFilter>("ALL");
  const [hotOnly, setHotOnly] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<{ code: string; mode: "register" | "loading" | "detail" | "error"; product?: SnapshotProduct } | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // La visita se cuenta una vez al abrir la página.
  useEffect(() => {
    let alive = true;
    fetch("/api/pvx/visit", { method: "POST" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return;
        setRegistered(!!d?.registered);
        setName(d?.name ?? null);
      })
      .catch(() => alive && setRegistered(false));
    return () => {
      alive = false;
    };
  }, []);

  // Se anota qué busca (cuando deja de escribir), para la cartera.
  function onSearch(v: string) {
    setQuery(v);
    setShown(PAGE);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = v.trim();
    if (q.length < 3) return;
    searchTimer.current = setTimeout(() => {
      fetch("/api/pvx/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: q }) }).catch(() => null);
    }, 1500);
  }

  const filtered = useMemo(() => {
    const q = norm(query.trim());
    return cards.filter((c) => (brand === "ALL" || c.brand === brand) && (!hotOnly || c.trend === "up") && (!q || norm(c.name).includes(q) || c.code.includes(q)));
  }, [cards, query, brand, hotOnly]);

  async function loadDetail(code: string) {
    setOpen({ code, mode: "loading" });
    const res = await fetch(`/api/pvx/product/${encodeURIComponent(code)}`).catch(() => null);
    if (res?.status === 401) {
      setRegistered(false);
      setOpen({ code, mode: "register" });
      return;
    }
    const d = res?.ok ? await res.json().catch(() => null) : null;
    setOpen(d?.product ? { code, mode: "detail", product: d.product } : { code, mode: "error" });
  }

  function openCard(code: string) {
    if (registered) loadDetail(code);
    else setOpen({ code, mode: "register" });
  }

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const hotCount = cards.filter((c) => c.trend === "up").length;

  return (
    <div>
      <header className="bg-[#16181d] text-white">
        <div className="mx-auto max-w-6xl px-4 pt-6 pb-10 sm:pt-8 sm:pb-14">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[22px] font-black tracking-tight">
              PROVEDIX<span className="text-[#ff5a1f]">.</span>
            </div>
            {name && <div className="text-[12.5px] text-white/70">Hola, {name.split(" ")[0]} 👋</div>}
          </div>
          <h1 className="mt-6 text-[30px] sm:text-[44px] font-black leading-[1.05] max-w-3xl">
            Productos ganadores <span className="text-[#ff5a1f]">con datos reales</span> de venta en Ecuador
          </h1>
          <p className="mt-3 text-[15px] sm:text-[17px] text-white/75 max-w-2xl">
            Mira gratis qué se está vendiendo de nuestras bodegas: cuánto se vende, a qué precio, en qué ciudades y con qué combos. Elige y véndelo en
            Dropi.
          </p>
          <div className="mt-5 flex flex-wrap gap-2 text-[12.5px]">
            <span className="rounded-full bg-white/10 px-3 py-1">✅ {cards.length} productos con ventas</span>
            {hotCount > 0 && <span className="rounded-full bg-white/10 px-3 py-1">🔥 {hotCount} en subida</span>}
            {windowTo && <span className="rounded-full bg-white/10 px-3 py-1">📅 Datos hasta el {dayLabel(windowTo)}</span>}
            <span className="rounded-full bg-[#ff5a1f] px-3 py-1 font-semibold">Gratis · sin suscripción</span>
          </div>
        </div>
      </header>

      <div className="sticky top-0 z-20 bg-[#f6f5f2]/95 backdrop-blur border-b border-[#e6e2da]">
        <div className="mx-auto max-w-6xl px-4 py-3 flex flex-col sm:flex-row gap-2 sm:items-center">
          <input
            value={query}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Busca un producto o ID…"
            className="w-full sm:max-w-sm rounded-lg border border-[#d9d6cf] bg-white px-3 py-2.5 text-[15px] outline-none focus:border-[#ff5a1f]"
          />
          <div className="flex gap-2 overflow-x-auto">
            {(["ALL", "MKT_PROVEDIX", "MKT_DAMIAN"] as BrandFilter[]).map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => {
                  setBrand(b);
                  setShown(PAGE);
                }}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-[12.5px] font-semibold cursor-pointer ${brand === b ? "bg-[#16181d] text-white border-[#16181d]" : "bg-white border-[#d9d6cf]"}`}
              >
                {b === "ALL" ? "Todos" : BRAND[b]}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setHotOnly(!hotOnly);
                setShown(PAGE);
              }}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-[12.5px] font-semibold cursor-pointer ${hotOnly ? "bg-[#ff5a1f] text-white border-[#ff5a1f]" : "bg-white border-[#d9d6cf]"}`}
            >
              🔥 En subida
            </button>
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {cards.length === 0 && <div className="py-20 text-center text-[#5b616b]">Muy pronto verás aquí los productos ganadores.</div>}
        {cards.length > 0 && filtered.length === 0 && <div className="py-16 text-center text-[#5b616b]">No encontramos productos con esa búsqueda.</div>}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
          {filtered.slice(0, shown).map((c, i) => (
            <div
              key={c.code}
              role="button"
              tabIndex={0}
              onClick={() => openCard(c.code)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openCard(c.code);
                }
              }}
              className="group text-left rounded-xl bg-white border border-[#ebe8e1] overflow-hidden hover:shadow-lg hover:-translate-y-0.5 transition cursor-pointer"
            >
              <div className="relative aspect-square bg-[#ebe8e1]">
                <PvxPhoto src={c.photo} alt={c.name} sizes="(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw" priority={i < 4} />
              </div>
              <div className="p-3">
                {/* Puesto y "En subida" fuera de la foto, para no tapar nada de la imagen. */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="rounded-full bg-[#16181d] text-white text-[10px] font-bold px-1.5 py-px">#{c.rank}</span>
                  {c.trend === "up" && <span className="rounded-full bg-[#ff5a1f] text-white text-[10px] font-bold px-1.5 py-px">🔥 En subida</span>}
                  <span className="text-[10.5px] font-bold uppercase tracking-wide text-[#8a8f98]">{BRAND[c.brand]}</span>
                </div>
                <div className="text-[13.5px] font-semibold leading-snug line-clamp-2 mt-0.5 min-h-[2.5em]">{c.name}</div>
                <div className="mt-2 text-[13px] font-bold text-[#16181d]">🔥 {c.soldRange} vendidos</div>
                <div className="text-[11.5px] text-[#5b616b]">{c.unitsRange} unidades en 30 días</div>
                <div className="mt-2">
                  <div className="flex flex-wrap gap-1">
                    <CopyId code={c.code} label="Dropi" />
                    {(c.rocketCodes ?? []).slice(0, 1).map((r) => (
                      <CopyId key={r} code={r} label="Rocket" />
                    ))}
                  </div>
                </div>
                <div className="mt-2.5 rounded-lg bg-[#fff4ee] text-[#ff5a1f] text-center text-[12px] font-bold py-1.5 group-hover:bg-[#ff5a1f] group-hover:text-white transition">
                  Ver precio, ganancia y ciudades
                </div>
              </div>
            </div>
          ))}
        </div>
        {filtered.length > shown && (
          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={() => setShown(shown + PAGE)}
              className="rounded-lg border border-[#d9d6cf] bg-white px-5 py-2.5 text-[14px] font-semibold hover:border-[#ff5a1f] cursor-pointer"
            >
              Ver más productos ({filtered.length - shown})
            </button>
          </div>
        )}
      </main>

      <footer className="border-t border-[#e6e2da] mt-6">
        <div className="mx-auto max-w-6xl px-4 py-6 text-[12px] text-[#8a8f98] leading-relaxed">
          Provedix · Importadora Damián — Guayaquil, Ecuador. Los datos salen de los despachos reales de nuestras bodegas, se muestran en
          rangos. No mostramos datos de clientes ni de tiendas. Si te registras, guardamos tu nombre y WhatsApp solo para enviarte productos
          ganadores; puedes pedir que los borremos cuando quieras.
        </div>
      </footer>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/55 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setOpen(null)}>
          <div
            className={`w-full sm:max-w-xl ${open.mode === "detail" ? "md:max-w-5xl" : ""} max-h-[94vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-[#f6f5f2]`}
            onClick={(e) => e.stopPropagation()}
          >
            {open.mode === "register" && (
              <PvxRegister
                onClose={() => setOpen(null)}
                onDone={(n) => {
                  setRegistered(true);
                  setName(n);
                  loadDetail(open.code);
                }}
              />
            )}
            {open.mode === "loading" && <div className="p-10 text-center text-[#5b616b]">Cargando…</div>}
            {open.mode === "error" && (
              <div className="p-8 text-center">
                <div className="text-[#5b616b]">No se pudo abrir este producto. Intenta de nuevo en un momento.</div>
                <button type="button" onClick={() => setOpen(null)} className="mt-4 text-[#ff5a1f] font-semibold cursor-pointer">
                  Cerrar
                </button>
              </div>
            )}
            {open.mode === "detail" && open.product && <PvxProductDetail p={open.product} onClose={() => setOpen(null)} />}
          </div>
        </div>
      )}
    </div>
  );
}
