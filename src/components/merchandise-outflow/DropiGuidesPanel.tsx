"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, FileText, Package, X } from "lucide-react";
import { uploadFile } from "@/lib/uploadFile";
import { ProductMatchPicker, type MatchCatalogItem } from "@/components/merchandise-reentry/ProductMatchPicker";
import { CatalogCode } from "@/components/shared/CatalogCode";
import { ExpandableName } from "@/components/ui/ExpandableName";
import { RegisterComboForm } from "./RegisterComboForm";
import { carrierLabel, sortCarriers } from "@/lib/carriers";

type ItemLite = MatchCatalogItem;
type Resolution =
  | { kind: "product"; catalogItem: ItemLite }
  | { kind: "combo"; comboCode: string; label: string | null; components: { catalogItem: ItemLite; quantity: number }[]; missingIds: string[] }
  | { kind: "comboNoRecipe"; comboCode: string }
  | { kind: "ignored"; label: string }
  | { kind: "unknown"; suggestion: ItemLite | null };
type Row = {
  code: string;
  name: string;
  quantity: number;
  byCarrier: Record<string, number>;
  labelUnits: number;
  variants: { label: string; quantity: number }[];
  resolution: Resolution;
};
type WarrantyLine = { guide: string; carrier: string; code: string; name: string; quantity: number; variant: string | null };
type ParseResult = {
  manifestDate: string | null;
  carriers: string[];
  guides: { number: string; carrier: string; warranty: boolean }[];
  rows: Row[];
  warranty: WarrantyLine[];
  unreadWarrantyGuides: string[];
  stockByItem: Record<string, number>;
};
type Decision = { kind: "product"; item: ItemLite } | { kind: "combo" } | { kind: "ignore" } | null;
// Garantía: qué sale de verdad (lo marca Yair, confirmado por el usuario).
type WarrantyDecision = { mode: "COMPLETE" } | { mode: "PARTIAL"; catalogItemIds: string[] } | { mode: "PIECE"; catalogItemId: string; piece: string } | null;

function initialDecision(r: Row): Decision {
  switch (r.resolution.kind) {
    case "product":
      return { kind: "product", item: r.resolution.catalogItem };
    case "combo":
      return r.resolution.missingIds.length === 0 ? { kind: "combo" } : null;
    case "ignored":
      return { kind: "ignore" };
    default:
      return null;
  }
}

function PhotoThumb({ url }: { url: string | undefined }) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" className="w-6 h-6 object-cover rounded border border-rule shrink-0" />
  ) : (
    <div className="w-6 h-6 rounded border border-dashed border-rule flex items-center justify-center text-steel shrink-0">
      <Package size={11} />
    </div>
  );
}

// Confirmado 2026-09-23, pedido de Yair aprobado por el usuario: Yair solo
// sube el PDF de guías que descarga de Dropi — la app saca de ahí los
// productos, cantidades, combos, colores y tallas (sin IA, ver
// src/lib/dropiGuidesPdf.ts). Solo pregunta lo que todavía no conoce, UNA
// vez: un código nuevo (¿qué producto es? / ¿es combo? / ¿no es producto?)
// y desde ahí queda aprendido para siempre.
export function DropiGuidesPanel({ onApplied }: { onApplied: (lotId: string) => void }) {
  const [files, setFiles] = useState<{ url: string; name: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [phase, setPhase] = useState<"idle" | "reading" | "preview" | "applying">("idle");
  const [data, setData] = useState<ParseResult | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [picking, setPicking] = useState<string | null>(null);
  const [registering, setRegistering] = useState<string | null>(null);
  const [warrantyDecisions, setWarrantyDecisions] = useState<Record<number, WarrantyDecision>>({});
  const [err, setErr] = useState("");

  async function handleFiles(list: FileList) {
    setErr("");
    setUploading(true);
    const added: { url: string; name: string }[] = [];
    for (const file of Array.from(list)) {
      if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
        setErr(`"${file.name}" no es un PDF — sube el PDF de guías que descargas de Dropi.`);
        continue;
      }
      const up = await uploadFile(file, "dropi-guides-pdf");
      if (!up.ok) {
        setErr(up.error);
        continue;
      }
      added.push({ url: up.url, name: file.name });
    }
    setFiles((f) => [...f, ...added]);
    setUploading(false);
  }

  async function read(keepDecisions = false) {
    if (files.length === 0) return;
    setErr("");
    setPhase("reading");
    const res = await fetch("/api/fulfillment-requests/dropi/guides/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileUrls: files.map((f) => f.url) }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(json?.error ?? "No se pudo leer el PDF.");
      setPhase("idle");
      return;
    }
    const d = json as ParseResult;
    setData(d);
    setDecisions((prev) => {
      const next: Record<string, Decision> = {};
      for (const r of d.rows) {
        const fresh = initialDecision(r);
        // Al volver a leer (ej. tras registrar un combo), lo que Yair ya
        // eligió a mano en otras filas se conserva.
        next[r.code] = fresh ?? (keepDecisions && prev[r.code]?.kind === "product" ? prev[r.code] : null);
      }
      return next;
    });
    // Al volver a leer se conserva lo que Yair ya marcó en cada garantía
    // (mismo orden de guías → mismo índice).
    if (!keepDecisions) setWarrantyDecisions({});
    setPicking(null);
    setRegistering(null);
    setPhase("preview");
  }

  function reset() {
    setFiles([]);
    setData(null);
    setDecisions({});
    setWarrantyDecisions({});
    setPhase("idle");
    setErr("");
  }

  async function includeAgain(r: Row) {
    if (r.resolution.kind === "ignored") {
      await fetch(`/api/fulfillment-requests/ignored-codes/${encodeURIComponent(r.code)}`, { method: "DELETE" });
      await read(true);
    } else {
      setDecisions((p) => ({ ...p, [r.code]: null }));
    }
  }

  const rows = data?.rows ?? [];
  const warranty = data?.warranty ?? [];
  const pending = rows.filter((r) => !decisions[r.code]);
  const ready = rows.filter((r) => decisions[r.code] && decisions[r.code]!.kind !== "ignore");
  const ignored = rows.filter((r) => decisions[r.code]?.kind === "ignore");
  const totalUnits = rows.reduce((s, r) => s + r.quantity, 0);
  const rowByCode = new Map(rows.map((r) => [r.code, r]));

  // Productos reales de un código ya resuelto (para garantías y stock).
  function partsOf(code: string): { item: ItemLite; perUnit: number }[] {
    const r = rowByCode.get(code);
    const d = decisions[code];
    if (!r || !d || d.kind === "ignore") return [];
    if (d.kind === "product") return [{ item: d.item, perUnit: 1 }];
    return r.resolution.kind === "combo" ? r.resolution.components.map((c) => ({ item: c.catalogItem, perUnit: c.quantity })) : [];
  }

  function warrantyReady(i: number, w: WarrantyLine): boolean {
    if (decisions[w.code]?.kind === "ignore") return true;
    const wd = warrantyDecisions[i];
    if (!wd || partsOf(w.code).length === 0) return false;
    if (wd.mode === "PARTIAL") return wd.catalogItemIds.length > 0;
    if (wd.mode === "PIECE") return !!wd.catalogItemId && !!wd.piece.trim();
    return true;
  }
  const pendingWarranty = warranty.filter((w, i) => !warrantyReady(i, w)).length;

  async function apply() {
    if (!data || pending.length > 0 || pendingWarranty > 0) return;
    setPhase("applying");
    setErr("");
    const res = await fetch("/api/fulfillment-requests/dropi/guides/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileUrls: files.map((f) => f.url),
        manifestDate: data.manifestDate,
        guides: data.guides.map((g) => ({ number: g.number, carrier: g.carrier })),
        rows: rows.map((r) => {
          const d = decisions[r.code]!;
          return {
            code: r.code,
            name: r.name,
            quantity: r.quantity,
            byCarrier: r.byCarrier,
            labelUnits: r.labelUnits,
            variants: r.variants,
            decision: d.kind === "product" ? { kind: "product", catalogItemId: d.item.id } : { kind: d.kind },
          };
        }),
        warranty: warranty
          .map((w, i) => ({ w, wd: warrantyDecisions[i] }))
          .filter(({ w, wd }) => wd && decisions[w.code]?.kind !== "ignore")
          .map(({ w, wd }) => ({ guide: w.guide, carrier: w.carrier, code: w.code, quantity: w.quantity, variant: w.variant, decision: wd })),
      }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(json?.error ?? "No se pudo guardar.");
      setPhase("preview");
      return;
    }
    reset();
    onApplied(json.lotId);
  }

  function renderWarranty(w: WarrantyLine, i: number) {
    const parts = partsOf(w.code);
    const wd = warrantyDecisions[i] ?? null;
    const set = (v: WarrantyDecision) => setWarrantyDecisions((p) => ({ ...p, [i]: v }));
    const isCombo = parts.length > 1;
    const ok = warrantyReady(i, w);
    return (
      <div key={`${w.guide}-${w.code}-${i}`} className={`rounded-md p-2.5 ${ok ? "bg-cloud" : "bg-gold/10 border border-gold/30"}`}>
        <div className="flex items-center gap-1.5 flex-wrap text-[12px]">
          <span className="font-mono text-[9.5px] font-bold uppercase rounded-full px-1.5 py-0.5 bg-red/10 text-red border border-red/30">Garantía</span>
          <span className="text-[10.5px] text-steel">
            Guía {w.guide} · {carrierLabel(w.carrier)}
          </span>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap text-[12px] mt-1">
          <CatalogCode code={w.code} />
          <ExpandableName text={w.name} className="font-semibold flex-1 min-w-0" />
          {w.variant && <span className="font-mono text-[10px] bg-teal/10 border border-teal/30 rounded-full px-2 py-0.5">{w.variant}</span>}
          <span className="font-mono text-[13px] font-bold text-teal shrink-0">{w.quantity}</span>
        </div>
        {decisions[w.code]?.kind === "ignore" ? (
          <div className="text-[11px] text-steel mt-1">Marcado como &quot;no es un producto&quot; — no se incluye.</div>
        ) : parts.length === 0 ? (
          <div className="text-[11px] mt-1" style={{ color: "#D9A441" }}>
            Primero indica arriba qué producto es el código {w.code}.
          </div>
        ) : (
          <div className="mt-1.5 text-[11.5px] flex flex-col gap-1">
            <div className="font-semibold">¿Qué sale de verdad?</div>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" checked={wd?.mode === "COMPLETE"} onChange={() => set({ mode: "COMPLETE" })} />
              Completo{isCombo ? ` (${parts.map((p) => p.item.name).join(" + ")})` : ""}
            </label>
            {isCombo && (
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" checked={wd?.mode === "PARTIAL"} onChange={() => set({ mode: "PARTIAL", catalogItemIds: [] })} />
                Solo parte del combo
              </label>
            )}
            {wd?.mode === "PARTIAL" && (
              <div className="pl-5 flex flex-col gap-0.5">
                {parts.map((p) => (
                  <label key={p.item.id} className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={wd.catalogItemIds.includes(p.item.id)}
                      onChange={(e) =>
                        set({ mode: "PARTIAL", catalogItemIds: e.target.checked ? [...wd.catalogItemIds, p.item.id] : wd.catalogItemIds.filter((x) => x !== p.item.id) })
                      }
                    />
                    <CatalogCode code={p.item.justCode} /> {p.item.name}
                  </label>
                ))}
              </div>
            )}
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" checked={wd?.mode === "PIECE"} onChange={() => set({ mode: "PIECE", catalogItemId: parts[0].item.id, piece: "" })} />
              Solo una pieza <span className="text-steel text-[10.5px]">(sale del stock de repuestos, no descuenta el producto)</span>
            </label>
            {wd?.mode === "PIECE" && (
              <div className="pl-5 flex items-center gap-1.5 flex-wrap">
                {isCombo && (
                  <select
                    className="rounded border border-rule bg-surface px-1.5 py-1 text-[11.5px]"
                    value={wd.catalogItemId}
                    onChange={(e) => set({ ...wd, catalogItemId: e.target.value })}
                  >
                    {parts.map((p) => (
                      <option key={p.item.id} value={p.item.id}>
                        {p.item.name}
                      </option>
                    ))}
                  </select>
                )}
                <input
                  type="text"
                  placeholder="¿Qué pieza? Ej. cargador"
                  className="flex-1 min-w-[10rem] rounded border border-rule bg-surface px-2 py-1 text-[11.5px]"
                  value={wd.piece}
                  onChange={(e) => set({ ...wd, piece: e.target.value })}
                />
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  function renderRow(r: Row) {
    const d = decisions[r.code];
    const res = r.resolution;
    const unread = r.variants.length > 0 ? r.quantity - Math.min(r.labelUnits, r.quantity) : 0;
    return (
      <div key={r.code} className={`rounded-md p-2.5 ${d ? "bg-cloud" : "bg-gold/10 border border-gold/30"}`}>
        <div className="flex items-center gap-1.5 flex-wrap text-[12px]">
          <CatalogCode code={r.code} />
          <ExpandableName text={r.name} className="font-semibold flex-1 min-w-0" />
          <span className="font-mono text-[13px] font-bold text-teal shrink-0">{r.quantity}</span>
        </div>
        {r.quantity > 0 ? (
          <div className="mt-0.5 text-[10.5px] text-steel">
            {sortCarriers(Object.keys(r.byCarrier))
              .map((c) => `${carrierLabel(c)} ${r.byCarrier[c]}`)
              .join(" · ")}
          </div>
        ) : (
          <div className="mt-0.5 text-[10.5px] text-steel">Solo en garantía (abajo)</div>
        )}
        {r.variants.length > 0 && (
          <div className="mt-1 flex items-center gap-1 flex-wrap">
            {r.variants.map((v) => (
              <span key={v.label} className="font-mono text-[10px] bg-teal/10 border border-teal/30 rounded-full px-2 py-0.5">
                {v.label}: {v.quantity}
              </span>
            ))}
            {unread > 0 && <span className="font-mono text-[10px] text-steel">+{unread} sin leer en guías</span>}
          </div>
        )}
        {partsOf(r.code)
          // Solo si se conoce su stock (un producto elegido a mano con el
          // buscador no viene en la lectura — se revisa igual en el corte).
          .filter((p) => data !== null && p.item.id in data.stockByItem && r.quantity * p.perUnit > data.stockByItem[p.item.id])
          .map((p) => (
            // Aviso temprano de stock (confirmado por el usuario 2026-09-23).
            <div key={p.item.id} className="mt-1 text-[11px] text-red flex items-start gap-1">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              <span>
                Stock insuficiente{partsOf(r.code).length > 1 ? ` de ${p.item.name}` : ""}: piden {r.quantity * p.perUnit}, en INVESTOCK hay {data?.stockByItem[p.item.id] ?? 0}.
              </span>
            </div>
          ))}

        <div className="mt-1.5 text-[11.5px]">
          {d?.kind === "product" && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <PhotoThumb url={d.item.photos[0]} />
              <span className="text-steel">→</span>
              <span>{d.item.name}</span>
              {d.item.justCode !== r.code && (
                <span className="text-[10.5px]" style={{ color: "#D9A441" }}>
                  {d.item.justCode ? `(${r.code} quedará como ID alterno de ${d.item.justCode}, el principal en INVESTOCK)` : `(se le pondrá el ID ${r.code})`}
                </span>
              )}
              {(res.kind !== "product" || d.item.id !== res.catalogItem.id) && (
                <button type="button" className="text-steel hover:text-teal cursor-pointer" onClick={() => setDecisions((p) => ({ ...p, [r.code]: null }))}>
                  Cambiar
                </button>
              )}
            </div>
          )}

          {res.kind === "combo" && res.components.length === 1 && res.components[0].quantity === 1 && res.missingIds.length === 0 && (
            // Confirmado 2026-09-23 por el usuario: Dropi publica el mismo
            // producto con varios IDs (nombre más bonito para vender), pero en
            // INVESTOCK existe uno solo — todos apuntan al ID principal.
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-mono text-[9.5px] font-bold uppercase text-steel">ID alterno de →</span>
              <PhotoThumb url={res.components[0].catalogItem.photos[0]} />
              <CatalogCode code={res.components[0].catalogItem.justCode} />
              <span>{res.components[0].catalogItem.name}</span>
            </div>
          )}

          {res.kind === "combo" && !(res.components.length === 1 && res.components[0].quantity === 1 && res.missingIds.length === 0) && (
            <div className="flex flex-col gap-0.5">
              <span className="font-mono text-[9.5px] font-bold uppercase" style={{ color: "#D9A441" }}>
                Combo — se abre en:
              </span>
              {res.components.map((c) => (
                <div key={c.catalogItem.id} className="flex items-center gap-1.5 pl-2">
                  <PhotoThumb url={c.catalogItem.photos[0]} />
                  <CatalogCode code={c.catalogItem.justCode} />
                  <span className="flex-1 min-w-0">{c.catalogItem.name}</span>
                  <span className="font-mono font-bold text-teal">{c.quantity * r.quantity}</span>
                </div>
              ))}
              {res.missingIds.length > 0 && (
                <div className="text-red text-[11px] mt-1 flex items-start gap-1">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                  <span>
                    Sin ID de Dropi: <b>{res.missingIds.join(", ")}</b>. Pide que le pongan su ID en Stock Actual o Base de datos de productos y dale a
                    &quot;Volver a leer&quot;.
                  </span>
                </div>
              )}
            </div>
          )}

          {d?.kind === "ignore" && (
            <div className="flex items-center gap-2 text-steel">
              <span>No es un producto — no se incluye{res.kind === "ignored" ? " (recordado)" : ""}.</span>
              <button type="button" className="text-teal font-semibold cursor-pointer" onClick={() => includeAgain(r)}>
                Volver a incluir
              </button>
            </div>
          )}

          {!d && (res.kind === "unknown" || res.kind === "comboNoRecipe") && (
            <>
              <div className="text-[11px] mb-1.5" style={{ color: "#D9A441" }}>
                {res.kind === "comboNoRecipe" ? "Combo sin receta todavía — dile a la app qué productos trae (una sola vez)." : "Código nuevo — dile a la app qué es (una sola vez, después lo recuerda)."}
              </div>
              {res.kind === "unknown" && /\s(y|\+)\s|combo|\bkit\b/i.test(r.name) && (
                <div className="text-[11px] mb-1.5 text-red flex items-start gap-1">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                  <span>El nombre parece de un combo (trae varios productos) — si es así, usa &quot;Es un combo&quot;, no elijas un solo producto.</span>
                </div>
              )}
              {picking === r.code ? (
                <ProductMatchPicker
                  referencePhotoUrl={null}
                  initialQuery={r.name}
                  searchUrl="/api/fulfillment-requests/catalog-search"
                  onConfirm={(item) => {
                    setDecisions((p) => ({ ...p, [r.code]: { kind: "product", item } }));
                    setPicking(null);
                  }}
                  onCancel={() => setPicking(null)}
                />
              ) : registering === r.code ? (
                <RegisterComboForm initialCode={r.code} initialLabel={r.name} onRegistered={() => read(true)} onCancel={() => setRegistering(null)} />
              ) : (
                <div className="flex items-center gap-x-3 gap-y-1 flex-wrap">
                  {res.kind === "unknown" && res.suggestion && (
                    <button
                      type="button"
                      className="flex items-center gap-1.5 rounded border border-teal px-2 py-1 font-semibold text-teal cursor-pointer"
                      onClick={() => setDecisions((p) => ({ ...p, [r.code]: { kind: "product", item: (res as { suggestion: ItemLite }).suggestion } }))}
                    >
                      <PhotoThumb url={res.suggestion.photos[0]} /> Es «{res.suggestion.name}»
                    </button>
                  )}
                  {res.kind === "unknown" && (
                    <button type="button" className="font-semibold text-teal cursor-pointer" onClick={() => setPicking(r.code)}>
                      Buscar producto
                    </button>
                  )}
                  <button type="button" className="font-semibold text-teal cursor-pointer" onClick={() => setRegistering(r.code)}>
                    Es un combo — registrar receta
                  </button>
                  {res.kind === "unknown" && (
                    <button type="button" className="text-steel hover:text-red cursor-pointer" onClick={() => setDecisions((p) => ({ ...p, [r.code]: { kind: "ignore" } }))}>
                      No es un producto
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="text-[12.5px] mb-3 bg-teal/10 border border-teal/25 rounded px-2.5 py-2">
        <b>Dropi — PDF de guías:</b> sube el PDF de guías tal como lo descargas de Dropi (puedes subir varios a la vez, uno por transportadora). La app saca sola los
        productos (por su ID madre de INVESTOCK), las cantidades por transportadora, los combos, los colores/tallas y las garantías. Solo te pregunta lo que todavía no conoce.
      </div>

      {phase === "idle" && (
        <>
          {files.length > 0 && (
            <div className="flex flex-col gap-1 mb-3">
              {files.map((f, i) => (
                <div key={f.url} className="flex items-center gap-2 text-[12px] bg-cloud rounded px-2.5 py-1.5">
                  <FileText size={14} className="text-steel shrink-0" />
                  <span className="flex-1 min-w-0 truncate">{f.name}</span>
                  <button type="button" className="text-steel hover:text-red cursor-pointer" onClick={() => setFiles((p) => p.filter((_, idx) => idx !== i))}>
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <label className="flex flex-col items-center justify-center gap-1.5 border-[1.5px] border-dashed border-rule hover:border-teal rounded-md py-6 cursor-pointer transition-colors mb-3">
            <FileText size={20} className="text-steel" />
            <div className="text-[13px] font-semibold">{uploading ? "Subiendo…" : "Subir PDF de guías de Dropi"}</div>
            <div className="text-[11px] text-steel">Ej. documento-23-09-2026_1009.pdf</div>
            <input type="file" accept="application/pdf,.pdf" multiple className="hidden" disabled={uploading} onChange={(e) => e.target.files && handleFiles(e.target.files)} />
          </label>
          {files.length > 0 && !uploading && (
            <button type="button" className="rounded border border-teal bg-teal px-3.5 py-2 text-[12.5px] font-bold text-navy cursor-pointer mb-3" onClick={() => read()}>
              Leer guías ({files.length} PDF)
            </button>
          )}
        </>
      )}

      {phase === "reading" && (
        <div className="flex items-center justify-center gap-2.5 py-6 text-steel text-[13px] mb-3">
          <span className="w-4 h-4 rounded-full border-2 border-rule border-t-teal animate-spin" /> Leyendo guías…
        </div>
      )}

      {err && <div className="text-red text-[12.5px] mb-3">{err}</div>}

      {(phase === "preview" || phase === "applying") && data && (
        <div className="bg-surface border border-rule rounded-md p-4 mb-3">
          <div className="font-display font-bold text-[14.5px] mb-1">Revisa antes de guardar</div>
          <div className="text-[11.5px] text-steel mb-3">
            {data.guides.length} guías{data.carriers.length > 0 ? ` (${sortCarriers(data.carriers).map(carrierLabel).join(", ")})` : ""}
            {data.manifestDate ? ` · manifiesto del ${data.manifestDate.split("-").reverse().join("/")}` : ""} · {rows.length} códigos · {totalUnits} unidades
          </div>

          {pending.length > 0 ? (
            <>
              <div className="mb-2 font-mono text-[10.5px] bg-gold/15 border border-gold/40 rounded-full px-2.5 py-1 inline-block" style={{ color: "#D9A441" }}>
                {pending.length} {pending.length === 1 ? "código necesita" : "códigos necesitan"} tu ayuda
              </div>
              <div className="flex flex-col gap-2 mb-4">{pending.map(renderRow)}</div>
            </>
          ) : (
            <div className="flex items-center gap-1.5 text-teal text-[12px] font-semibold mb-3">
              <CheckCircle2 size={14} /> Todo reconocido
            </div>
          )}

          <div className="text-[11px] font-semibold text-steel mb-1.5">Listos ({ready.length})</div>
          <div className="flex flex-col gap-1.5 mb-3 max-h-[28rem] overflow-y-auto">{ready.map(renderRow)}</div>

          {ignored.length > 0 && (
            <>
              <div className="text-[11px] font-semibold text-steel mb-1.5">No son productos ({ignored.length})</div>
              <div className="flex flex-col gap-1.5 mb-3">{ignored.map(renderRow)}</div>
            </>
          )}

          {(warranty.length > 0 || data.unreadWarrantyGuides.length > 0) && (
            <>
              <div className="text-[11px] font-semibold text-steel mb-1.5">
                Garantías ({warranty.length}) — marca qué sale de verdad en cada una
              </div>
              {data.unreadWarrantyGuides.length > 0 && (
                <div className="text-[11px] text-red mb-1.5 flex items-start gap-1">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                  <span>
                    No pude leer el producto de estas guías de garantía: {data.unreadWarrantyGuides.join(", ")}. Revísalas en el PDF y avísale a Daniel qué sale.
                  </span>
                </div>
              )}
              <div className="flex flex-col gap-1.5 mb-3">{warranty.map(renderWarranty)}</div>
            </>
          )}

          <div className="flex items-center gap-2.5 flex-wrap">
            <button
              type="button"
              disabled={phase === "applying" || pending.length > 0 || pendingWarranty > 0}
              className="rounded border border-teal bg-teal px-3.5 py-2 text-[12.5px] font-bold text-navy cursor-pointer disabled:opacity-60"
              onClick={apply}
            >
              {phase === "applying" ? "Guardando…" : "Guardar en el corte de hoy"}
            </button>
            <button type="button" className="text-steel text-[12.5px] cursor-pointer" onClick={() => read(true)} disabled={phase === "applying"}>
              Volver a leer
            </button>
            <button type="button" className="text-steel text-[12.5px] cursor-pointer" onClick={reset} disabled={phase === "applying"}>
              Cancelar
            </button>
            {(pending.length > 0 || pendingWarranty > 0) && (
              <span className="text-[11.5px]" style={{ color: "#D9A441" }}>
                {pending.length > 0 ? `Resuelve los ${pending.length} código(s) pendientes` : `Marca qué sale en ${pendingWarranty} garantía(s)`} antes de guardar.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
