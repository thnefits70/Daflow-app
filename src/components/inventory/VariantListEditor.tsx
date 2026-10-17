"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Search, Shirt } from "lucide-react";
import { CatalogCode } from "@/components/shared/CatalogCode";
import type { VariantEditProduct } from "@/lib/variantEdit";

type Recent = { catalogItemId: string; product: string; justCode: string | null; detail: string; userName: string | null; at: string };

// Desde la fila de un producto en el conteo se abre este editor con ese producto.
export const OPEN_VARIANT_EDITOR = "daflow:open-variant-editor";
// Avisa al conteo que la lista cambió, para que recargue los nombres.
export const VARIANTS_CHANGED = "daflow:variants-changed";

async function fetchJson(url: string) {
  const r = await fetch(url, { cache: "no-store" }).catch(() => null);
  return r?.ok ? r.json() : null;
}

async function loadProduct(id: string): Promise<VariantEditProduct | null> {
  const d = await fetchJson(`/api/product-variants?id=${encodeURIComponent(id)}`);
  return d?.product ?? null;
}

function when(iso: string): string {
  return new Date(iso).toLocaleString("es-EC", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "America/Guayaquil" });
}

// Pedido del usuario 2026-10-15 (aprobado por Daniel): todo el equipo de
// INVESTOCK edita la lista de tallas/colores de un producto, siempre. Solo
// nombres: igual que el conteo, aquí no se ve cuánto dice el sistema.
export function VariantListEditor({ isLead, canEdit = false }: { isLead: boolean; canEdit?: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<VariantEditProduct[] | null>(null);
  const [recent, setRecent] = useState<Recent[] | null>(null);
  const [product, setProduct] = useState<VariantEditProduct | null>(null);

  function openProduct(id: string) {
    loadProduct(id).then((p) => p && setProduct(p));
  }

  useEffect(() => {
    if (!open || product) return;
    const t = setTimeout(async () => {
      const d = await fetchJson(`/api/product-variants?q=${encodeURIComponent(q)}`);
      setResults(d?.products ?? []);
      if (d?.recent) setRecent(d.recent);
    }, 300);
    return () => clearTimeout(t);
  }, [q, open, product]);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      setOpen(true);
      loadProduct(id).then((p) => p && setProduct(p));
      document.getElementById("variant-list-editor")?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    window.addEventListener(OPEN_VARIANT_EDITOR, onOpen);
    return () => window.removeEventListener(OPEN_VARIANT_EDITOR, onOpen);
  }, []);

  return (
    <div id="variant-list-editor" className="border border-rule rounded-md mb-4 max-w-3xl scroll-mt-4">
      <button type="button" className="w-full flex items-center gap-2 p-3 text-left cursor-pointer" onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <Shirt size={16} className="text-teal" />
        <span className="font-display font-bold text-[15px]">Tallas y colores de los productos</span>
      </button>
      {open && (
        <div className="px-3 pb-3 text-[13px]">
          <p className="text-steel text-[12px] mb-2">
            {canEdit
              ? "Agrega, cambia el nombre, junta o quita tallas y colores. El stock total del producto no cambia, solo cómo se reparte. Lo que está como «Sin talla» se queda así hasta el siguiente conteo. Para dejarlas como en Dropi (ID de variación + nombre + lo contado), usa «Variantes Dropi» en Stock Actual."
              : "Las tallas y colores de cada producto. Solo DANIEL los cambia (van como en Dropi); si falta alguno o está mal escrito, avísale."}
          </p>
          {product ? (
            <ProductEditor
              readOnly={!canEdit}
              product={product}
              onBack={() => setProduct(null)}
              onChanged={() => {
                openProduct(product.id);
                window.dispatchEvent(new Event(VARIANTS_CHANGED));
              }}
            />
          ) : (
            <>
              <span className="relative block mb-2">
                <Search size={14} className="absolute left-2.5 top-2.5 text-steel" />
                <input className="w-full rounded border border-rule bg-surface pl-8 pr-2 py-2 text-[14px]" placeholder="Buscar producto o ID" value={q} onChange={(e) => setQ(e.target.value)} />
              </span>
              {q.trim().length >= 2 && results && results.length === 0 && <div className="text-steel">No se encontró ningún producto.</div>}
              <div className="flex flex-col gap-1">
                {results?.map((p) => (
                  <button key={p.id} type="button" className="flex items-center gap-2 border border-rule rounded p-2 text-left cursor-pointer hover:border-teal" onClick={() => setProduct(p)}>
                    {p.photo && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img loading="lazy" src={p.photo} alt="" className="w-9 h-9 rounded object-cover shrink-0" />
                    )}
                    <span className="flex-1 min-w-0">
                      <span className="block truncate font-semibold">{p.name}</span>
                      <span className="block text-steel text-[11.5px] truncate">
                        {p.justCode ? <CatalogCode code={p.justCode} size="text-[11px]" /> : "sin ID"} · {p.variants.length > 0 ? p.variants.map((v) => v.name).join(" · ") : "sin tallas ni colores"}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
              {isLead && !q.trim() && recent && recent.length > 0 && (
                <div className="mt-3">
                  <div className="font-semibold text-[12.5px] mb-1">Últimos cambios del equipo</div>
                  <div className="flex flex-col gap-0.5 text-[12px]">
                    {recent.map((r, i) => (
                      <button key={i} type="button" className="text-left cursor-pointer hover:text-teal" onClick={() => openProduct(r.catalogItemId)}>
                        <span className="text-steel">{when(r.at)}</span> · <b>{r.userName ?? "—"}</b> · {r.product}: {r.detail}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ProductEditor({ product, onBack, onChanged, readOnly = false }: { product: VariantEditProduct; onBack: () => void; onChanged: () => void; readOnly?: boolean }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  async function act(body: Record<string, unknown>, done: string): Promise<boolean> {
    setBusy(true);
    setErr("");
    setMsg("");
    const res = await fetch("/api/product-variants", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      const j = res ? await res.json().catch(() => null) : null;
      setErr(j?.error ?? "No se pudo guardar.");
      return false;
    }
    setMsg(done);
    onChanged();
    return true;
  }

  const chosen = product.variants.filter((v) => selected.has(v.id));
  const mergeTarget = chosen.find((v) => v.id === target) ?? chosen[0];

  async function merge() {
    if (!mergeTarget || chosen.length < 2) return;
    const others = chosen.filter((v) => v.id !== mergeTarget.id);
    if (!window.confirm(`¿Juntar ${others.map((v) => `«${v.name}»`).join(", ")} en «${mergeTarget.name}»? Sus unidades pasan a «${mergeTarget.name}».`)) return;
    if (await act({ action: "merge", targetId: mergeTarget.id, sourceIds: others.map((v) => v.id) }, `Listo: quedó todo en «${mergeTarget.name}».`)) {
      setSelected(new Set());
      setTarget("");
    }
  }

  return (
    <div>
      <button type="button" className="text-teal text-[12.5px] font-semibold cursor-pointer mb-2" onClick={onBack}>
        ← Buscar otro producto
      </button>
      <div className="flex items-center gap-2 mb-2">
        {product.photo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={product.photo} alt="" className="w-10 h-10 rounded object-cover shrink-0" />
        )}
        <div className="min-w-0">
          <div className="font-semibold break-words">{product.name}</div>
          <div className="text-steel text-[11.5px]">{product.justCode ? <CatalogCode code={product.justCode} size="text-[11px]" /> : "sin ID"}</div>
        </div>
      </div>

      {product.variants.length === 0 && <div className="text-steel mb-2">Este producto todavía no tiene tallas ni colores.</div>}
      <div className="flex flex-col gap-1 mb-2">
        {product.variants.map((v) => (
          <div key={v.id} className={`flex items-center gap-2 border rounded px-2 py-1.5 ${selected.has(v.id) ? "border-teal bg-teal/5" : "border-rule"}`}>
            {!readOnly && (
            <input
              type="checkbox"
              className="w-4 h-4 shrink-0 cursor-pointer"
              title="Marcar para juntar"
              checked={selected.has(v.id)}
              onChange={(e) => setSelected((s) => { const n = new Set(s); if (e.target.checked) n.add(v.id); else n.delete(v.id); return n; })}
            />
            )}
            {renaming?.id === v.id ? (
              <>
                <input autoFocus maxLength={60} className="flex-1 min-w-0 rounded border border-teal bg-surface px-2 py-1 text-[14px]" value={renaming.name} onChange={(e) => setRenaming({ id: v.id, name: e.target.value })} />
                <button type="button" disabled={busy || !renaming.name.trim()} className="rounded border border-teal bg-teal px-2 py-1 font-bold text-navy text-[12px] cursor-pointer disabled:opacity-40" onClick={async () => { if (await act({ action: "rename", variantId: v.id, name: renaming.name }, "Nombre cambiado.")) setRenaming(null); }}>
                  Guardar
                </button>
                <button type="button" className="text-steel text-[12px] cursor-pointer" onClick={() => setRenaming(null)}>Cancelar</button>
              </>
            ) : (
              <>
                <span className="flex-1 min-w-0 break-words text-[14px]">{v.name}</span>
                {!readOnly && (
                <>
                <button type="button" disabled={busy} className="text-teal text-[12px] cursor-pointer" onClick={() => setRenaming({ id: v.id, name: v.name })}>Cambiar nombre</button>
                <button type="button" disabled={busy} className="text-steel hover:text-red text-[12px] cursor-pointer" onClick={() => { if (window.confirm(`¿Quitar «${v.name}» de la lista?`)) act({ action: "remove", variantId: v.id }, `«${v.name}» quitado.`); }}>
                  Quitar
                </button>
                </>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      {chosen.length === 1 && <div className="text-steel text-[12px] mb-2">Marca otra talla o color para juntarlas.</div>}
      {chosen.length >= 2 && (
        <div className="border border-teal/50 bg-teal/5 rounded p-2 mb-2 flex flex-wrap items-center gap-2">
          <span>Juntar las {chosen.length} marcadas en:</span>
          <select className="rounded border border-rule bg-surface px-2 py-1 text-[13px]" value={mergeTarget?.id ?? ""} onChange={(e) => setTarget(e.target.value)}>
            {chosen.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
          <button type="button" disabled={busy} className="rounded border border-teal bg-teal px-3 py-1 font-bold text-navy cursor-pointer disabled:opacity-40" onClick={merge}>
            Juntar
          </button>
        </div>
      )}

      {!readOnly && (
      <div className="flex items-center gap-2">
        <input maxLength={60} className="flex-1 min-w-0 rounded border border-rule bg-surface px-2 py-1.5 text-[14px]" placeholder="Nueva talla o color (ej. Rojo, XL)" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button type="button" disabled={busy || !newName.trim()} className="rounded border border-teal px-3 py-1.5 font-bold text-teal cursor-pointer disabled:opacity-40" onClick={async () => { if (await act({ action: "add", catalogItemId: product.id, name: newName }, `«${newName.trim()}» agregado.`)) setNewName(""); }}>
          ➕ Agregar
        </button>
      </div>
      )}

      {msg && <div className="text-teal mt-2">{msg}</div>}
      {err && <div className="text-red mt-2">{err}</div>}

      {product.history.length > 0 && (
        <div className="mt-3 text-[12px]">
          <div className="font-semibold mb-0.5">Últimos cambios</div>
          {product.history.map((h, i) => (
            <div key={i} className="text-steel">
              {when(h.at)} · <b className="text-ink">{h.userName ?? "—"}</b> · {h.detail}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
