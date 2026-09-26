"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, FileText, Package, X } from "lucide-react";
import { uploadFile } from "@/lib/uploadFile";
import { ProductMatchPicker, type MatchCatalogItem } from "@/components/merchandise-reentry/ProductMatchPicker";
import { CatalogCode } from "@/components/shared/CatalogCode";
import { ExpandableName } from "@/components/ui/ExpandableName";
import { RegisterComboForm } from "./RegisterComboForm";
import { carrierLabel, sortCarriers } from "@/lib/carriers";
import { useFormDraft } from "@/lib/useFormDraft";

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
  uncertainWarrantyGuides: string[];
  warnings: string[];
  stockByItem: Record<string, number>;
};
type ComboPart = { catalogItem: ItemLite; quantity: number };
// comboCode = el combo de Dropi que corresponde (para un código de Rocket,
// el combo al que Yair lo vinculó).
type Decision = { kind: "product"; item: ItemLite } | { kind: "combo"; comboCode: string; components: ComboPart[] } | { kind: "ignore" } | null;

// Confirmado 2026-09-25: los códigos de Rocket vienen como "R14599" (ver
// dropiGuidesPdf) — se muestran como "Rocket 14599", nunca como ID de Dropi.
const isRocket = (code: string) => code.startsWith("R");
// "RN:…" = etiqueta de Gintracom de Rocket, que no trae ID (se reconoce por nombre).
const rocketLabel = (code: string) => (code.startsWith("RN:") ? "Rocket (sin ID)" : `Rocket ${code.slice(1)}`);
function RowCode({ code }: { code: string }) {
  if (!isRocket(code)) return <CatalogCode code={code} />;
  return <span className="font-mono text-[10.5px] font-bold rounded bg-navy/5 border border-rule px-1.5 py-0.5">{rocketLabel(code)}</span>;
}
// Garantía: qué sale de verdad (lo marca Yair, confirmado por el usuario).
type WarrantyDecision = { mode: "COMPLETE" } | { mode: "PARTIAL"; catalogItemIds: string[] } | { mode: "PIECE"; catalogItemId: string; piece: string } | null;

function initialDecision(r: Row): Decision {
  switch (r.resolution.kind) {
    case "product":
      return { kind: "product", item: r.resolution.catalogItem };
    case "combo":
      return r.resolution.missingIds.length === 0 ? { kind: "combo", comboCode: r.resolution.comboCode, components: r.resolution.components } : null;
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
  // warranty: PDF de la sección Garantías de Dropi (lo marca Yair).
  const [files, setFiles] = useState<{ url: string; name: string; warranty?: boolean }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [phase, setPhase] = useState<"idle" | "reading" | "preview" | "applying">("idle");
  const [data, setData] = useState<ParseResult | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [picking, setPicking] = useState<string | null>(null);
  const [registering, setRegistering] = useState<string | null>(null);
  const [warrantyDecisions, setWarrantyDecisions] = useState<Record<number, WarrantyDecision>>({});
  const [err, setErr] = useState("");

  // Pedido del usuario 2026-09-25: al recargar la página se perdía todo lo
  // que Yair ya había elegido (productos, combos vinculados, garantías)
  // porque solo se guarda al final con "Guardar". Ahora se respalda solo y
  // vuelve tal cual al recargar.
  // Pedido del usuario 2026-09-26: al día siguiente seguían ahí los PDF de
  // ayer (subidos pero nunca guardados) y no se veía cómo quitarlos. Ahora el
  // respaldo recuerda de qué día es y, si no es de hoy, se avisa con un botón
  // para descartarlo todo. No se borra solo: puede ser trabajo sin terminar.
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Guayaquil" });
  const [draftDay, setDraftDay] = useState(today);
  type GuidesDraft = { files: typeof files; data: ParseResult | null; decisions: typeof decisions; warrantyDecisions: typeof warrantyDecisions; day?: string };
  const { clearDraft } = useFormDraft<GuidesDraft>(
    "dropi-guides-panel",
    { files, data, decisions, warrantyDecisions, day: draftDay },
    (d) => {
      // Respaldo de antes de este cambio (sin día) = de un día anterior.
      setDraftDay(d.day ?? "");
      setFiles(d.files ?? []);
      setData(d.data ?? null);
      setDecisions(d.decisions ?? {});
      setWarrantyDecisions(d.warrantyDecisions ?? {});
      setPhase(d.data ? "preview" : "idle");
    },
    (d) => d.files.length === 0
  );

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
    // Si ya no quedaba nada de antes, lo que se sube ahora es de hoy.
    if (files.length === 0) setDraftDay(today);
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
      body: JSON.stringify({ fileUrls: files.map((f) => f.url), warrantyFileUrls: files.filter((f) => f.warranty).map((f) => f.url) }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(json?.error ?? "No se pudo leer el PDF.");
      setPhase("idle");
      return;
    }
    const d = json as ParseResult;
    // Lo marcado en garantías va por posición: si la lista cambió (ej. Yair
    // cambió un PDF a Pedidos/Garantías), se empieza de cero para no dejar
    // una decisión en la garantía equivocada.
    const sig = (x: ParseResult | null) => (x?.warranty ?? []).map((w) => `${w.guide}|${w.code}`).join(",");
    if (sig(d) !== sig(data)) setWarrantyDecisions({});
    setData(d);
    setDecisions((prev) => {
      const next: Record<string, Decision> = {};
      for (const r of d.rows) {
        const fresh = initialDecision(r);
        // Al volver a leer (ej. tras registrar un combo), lo que Yair ya
        // eligió a mano en otras filas se conserva.
        next[r.code] = fresh ?? (keepDecisions ? prev[r.code] ?? null : null);
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
    setDraftDay(today);
  }

  // Confirmado 2026-09-25: en Gintracom/Laar/Urbano todavía no sabemos cómo
  // viene una garantía — "SIN RECAUDO" puede ser pago anticipado (el cliente
  // ya pagó, solo se entrega). Yair lo corrige acá y queda anotado en los
  // avisos guardados para afinar la regla.
  function toPrepaid(i: number) {
    if (!data) return;
    const w = data.warranty[i];
    const rows = data.rows.map((r) =>
      r.code === w.code
        ? {
            ...r,
            quantity: r.quantity + w.quantity,
            labelUnits: r.labelUnits + w.quantity,
            byCarrier: { ...r.byCarrier, [w.carrier]: (r.byCarrier[w.carrier] ?? 0) + w.quantity },
            variants: w.variant
              ? r.variants.some((v) => v.label === w.variant)
                ? r.variants.map((v) => (v.label === w.variant ? { ...v, quantity: v.quantity + w.quantity } : v))
                : [...r.variants, { label: w.variant, quantity: w.quantity }]
              : r.variants,
          }
        : r
    );
    setData({
      ...data,
      rows,
      warranty: data.warranty.filter((_, idx) => idx !== i),
      guides: data.guides.map((g) => (g.number === w.guide ? { ...g, warranty: false } : g)),
      warnings: [...data.warnings, `Yair marcó la guía ${w.guide} (${carrierLabel(w.carrier)}, SIN RECAUDO) como pago anticipado, no garantía.`],
    });
    setWarrantyDecisions((prev) => {
      const next: Record<number, WarrantyDecision> = {};
      for (const [k, v] of Object.entries(prev)) {
        const n = Number(k);
        if (n < i) next[n] = v;
        else if (n > i) next[n - 1] = v;
      }
      return next;
    });
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
    return d.components.map((c) => ({ item: c.catalogItem, perUnit: c.quantity }));
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
        parseWarnings: data.warnings,
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
            decision: d.kind === "product" ? { kind: "product", catalogItemId: d.item.id } : d.kind === "combo" ? { kind: "combo", comboCode: d.comboCode } : { kind: "ignore" },
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
    clearDraft();
    onApplied(json.lotId);
  }

  function fileKindToggle(i: number) {
    const f = files[i];
    return (
      <div className="flex rounded border border-rule overflow-hidden text-[11px] font-semibold shrink-0">
        {[false, true].map((w) => (
          <button
            key={String(w)}
            type="button"
            disabled={phase === "applying"}
            className={`px-2 py-0.5 cursor-pointer ${!!f.warranty === w ? (w ? "bg-red/15 text-red" : "bg-teal/15 text-teal") : "text-steel"}`}
            onClick={() => setFiles((p) => p.map((x, idx) => (idx === i ? { ...x, warranty: w } : x)))}
          >
            {w ? "Garantías" : "Pedidos"}
          </button>
        ))}
      </div>
    );
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
          <RowCode code={w.code} />
          <ExpandableName text={w.name} className="font-semibold flex-1 min-w-0" />
          {w.variant && <span className="font-mono text-[10px] bg-teal/10 border border-teal/30 rounded-full px-2 py-0.5">{w.variant}</span>}
          <span className="font-mono text-[13px] font-bold text-teal shrink-0" title="Unidades de esta guía de garantía">
            {w.quantity} unid.
          </span>
        </div>
        {data?.uncertainWarrantyGuides.includes(w.guide) && (
          <div className="mt-1 text-[11px] flex items-center gap-2 flex-wrap" style={{ color: "var(--color-gold)" }}>
            <span>
              No se cobra al entregar (&quot;SIN RECAUDO&quot;) — puede ser garantía o un pedido ya pagado por adelantado. Revísala: si no es garantía, márcala.
            </span>
            <button type="button" className="font-semibold text-teal cursor-pointer" onClick={() => toPrepaid(i)}>
              Es pago anticipado (no garantía)
            </button>
          </div>
        )}
        {decisions[w.code]?.kind === "ignore" ? (
          <div className="text-[11px] text-steel mt-1">Marcado como &quot;no es un producto&quot; — no se incluye.</div>
        ) : parts.length === 0 ? (
          <div className="text-[11px] mt-1" style={{ color: "var(--color-gold)" }}>
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
          <RowCode code={r.code} />
          <ExpandableName text={r.name} className="font-semibold flex-1 min-w-0" />
          <span className="font-mono text-[13px] font-bold text-teal shrink-0" title="Total de unidades de este ID en el corte de hoy">
            {r.quantity} unid.
          </span>
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
              {d.item.justCode ? <CatalogCode code={d.item.justCode} /> : <span className="font-mono text-[10.5px] text-steel">sin ID en INVESTOCK</span>}
              {isRocket(r.code)
                ? res.kind !== "product" && (
                    <span className="text-[10.5px]" style={{ color: "var(--color-gold)" }}>
                      ({rocketLabel(r.code)} quedará vinculado a este producto)
                    </span>
                  )
                : d.item.justCode !== r.code && (
                    <span className="text-[10.5px]" style={{ color: "var(--color-gold)" }}>
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
              <span className="font-mono text-[9.5px] font-bold uppercase" style={{ color: "var(--color-gold)" }}>
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

          {d?.kind === "combo" && res.kind !== "combo" && (
            // Código de Rocket recién vinculado a un combo de Dropi.
            <div className="flex flex-col gap-0.5">
              <span className="font-mono text-[9.5px] font-bold uppercase" style={{ color: "var(--color-gold)" }}>
                Combo {d.comboCode} — se abre en:
              </span>
              {d.components.map((c) => (
                <div key={c.catalogItem.id} className="flex items-center gap-1.5 pl-2">
                  <PhotoThumb url={c.catalogItem.photos[0]} />
                  <CatalogCode code={c.catalogItem.justCode} />
                  <span className="flex-1 min-w-0">{c.catalogItem.name}</span>
                  <span className="font-mono font-bold text-teal">{c.quantity * r.quantity}</span>
                </div>
              ))}
              <button type="button" className="text-steel hover:text-teal cursor-pointer text-left text-[11px]" onClick={() => setDecisions((p) => ({ ...p, [r.code]: null }))}>
                Cambiar
              </button>
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
              <div className="text-[11px] mb-1.5" style={{ color: "var(--color-gold)" }}>
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
              ) : registering === r.code && isRocket(r.code) ? (
                <RocketComboLink
                  initialCode={res.kind === "comboNoRecipe" ? res.comboCode : ""}
                  label={r.name}
                  onLinked={(comboCode, components) => {
                    setDecisions((p) => ({ ...p, [r.code]: { kind: "combo", comboCode, components } }));
                    setRegistering(null);
                  }}
                  onCancel={() => setRegistering(null)}
                />
              ) : registering === r.code ? (
                <RegisterComboForm initialCode={res.kind === "comboNoRecipe" ? res.comboCode : r.code} initialLabel={r.name} onRegistered={() => read(true)} onCancel={() => setRegistering(null)} />
              ) : (
                <div className="flex items-center gap-x-3 gap-y-1 flex-wrap">
                  {res.kind === "unknown" && res.suggestion && (
                    <button
                      type="button"
                      className="flex items-center gap-1.5 rounded border border-teal px-2 py-1 font-semibold text-teal cursor-pointer"
                      onClick={() => setDecisions((p) => ({ ...p, [r.code]: { kind: "product", item: (res as { suggestion: ItemLite }).suggestion } }))}
                    >
                      <PhotoThumb url={res.suggestion.photos[0]} /> Es «{res.suggestion.name}»
                      {/* ID de INVESTOCK a la vista para confirmar que es el producto correcto (pedido del usuario 2026-09-25). */}
                      <span className="font-mono text-[10.5px] font-normal text-steel">
                        {res.suggestion.justCode ? `ID ${res.suggestion.justCode}` : "sin ID en INVESTOCK"}
                      </span>
                    </button>
                  )}
                  {res.kind === "unknown" && (
                    <button type="button" className="font-semibold text-teal cursor-pointer" onClick={() => setPicking(r.code)}>
                      Buscar producto
                    </button>
                  )}
                  <button type="button" className="font-semibold text-teal cursor-pointer" onClick={() => setRegistering(r.code)}>
                    {isRocket(r.code) ? "Es un combo" : "Es un combo — registrar receta"}
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

      {files.length > 0 && draftDay !== today && phase !== "applying" && (
        <div className="flex flex-wrap items-center gap-2 text-[12.5px] mb-3 rounded px-2.5 py-2 border" style={{ borderColor: "#D9A44166", background: "#D9A4411A" }}>
          <AlertTriangle size={14} className="shrink-0" style={{ color: "var(--color-gold)" }} />
          <span className="flex-1 min-w-[200px]">
            Estos PDF se subieron{draftDay ? ` el ${draftDay.split("-").reverse().join("/")}` : " otro día"} y <b>nunca se guardaron</b>. Si hoy vas a subir los nuevos, descártalos primero.
          </span>
          <button type="button" className="rounded border border-red px-2.5 py-1 text-[12px] font-semibold text-red cursor-pointer" onClick={reset}>
            Descartar y empezar de cero
          </button>
        </div>
      )}

      {phase === "idle" && (
        <>
          {files.length > 0 && (
            <div className="flex flex-col gap-1 mb-3">
              {files.map((f, i) => (
                <div key={f.url} className="flex items-center gap-2 text-[12px] bg-cloud rounded px-2.5 py-1.5">
                  <FileText size={14} className="text-steel shrink-0" />
                  <span className="flex-1 min-w-0 truncate">{f.name}</span>
                  {fileKindToggle(i)}
                  <button type="button" className="text-steel hover:text-red cursor-pointer" onClick={() => setFiles((p) => p.filter((_, idx) => idx !== i))}>
                    <X size={13} />
                  </button>
                </div>
              ))}
              <div className="text-[11px] text-steel">
                Marca <b className="text-red">Garantías</b> en el PDF que descargaste de la sección Garantías de Dropi — todas sus guías salen como garantía. En los de{" "}
                <b className="text-teal">Pedidos</b> nada es garantía (&quot;SIN RECAUDO&quot; = pagado por adelantado).
              </div>
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

          {data.warnings.length > 0 && (
            // Pedido del usuario 2026-09-25: explicarle a Yair qué no se pudo
            // leer bien, para ir ajustando la lectura en el camino.
            <div className="text-[11.5px] bg-gold/10 border border-gold/40 rounded-md p-2.5 mb-3">
              <div className="font-semibold mb-1 flex items-center gap-1.5" style={{ color: "var(--color-gold)" }}>
                <AlertTriangle size={13} /> Cosas que no pude leer bien
              </div>
              <ul className="list-disc pl-4 flex flex-col gap-0.5">
                {data.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
              <div className="text-[10.5px] text-steel mt-1">Puedes guardar igual. Quedan anotados para que el administrador ajuste la lectura; si se repiten, avísale.</div>
            </div>
          )}

          {pending.length > 0 ? (
            <>
              <div className="mb-2 font-mono text-[10.5px] bg-gold/15 border border-gold/40 rounded-full px-2.5 py-1 inline-block" style={{ color: "var(--color-gold)" }}>
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

          {/* Cambiar Pedidos/Garantías sin perder lo ya elegido: se marca y
              se da "Volver a leer" (que conserva las decisiones). */}
          <div className="flex flex-col gap-1 mb-3">
            <div className="text-[11px] text-steel">¿Algún PDF es de la sección Garantías de Dropi? Márcalo y dale a &quot;Volver a leer&quot;:</div>
            {files.map((f, i) => (
              <div key={f.url} className="flex items-center gap-2 text-[12px] bg-cloud rounded px-2.5 py-1.5">
                <FileText size={14} className="text-steel shrink-0" />
                <span className="flex-1 min-w-0 truncate">{f.name}</span>
                {fileKindToggle(i)}
              </div>
            ))}
          </div>

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
            {/* 2026-09-26: Yair canceló para releer y perdió lo ya elegido
                (nada se guarda hasta "Guardar"). Se pregunta antes y se
                recuerda que "Volver a leer" lo conserva. */}
            <button
              type="button"
              className="text-steel text-[12.5px] cursor-pointer"
              onClick={() => {
                if (window.confirm("¿Borrar todo? Se pierden los PDF subidos y todo lo que ya elegiste (nada está guardado todavía).\n\nSi solo quieres que la app lea de nuevo los PDF, usa \"Volver a leer\": conserva lo que elegiste.")) reset();
              }}
              disabled={phase === "applying"}
            >
              Cancelar
            </button>
            {(pending.length > 0 || pendingWarranty > 0) && (
              <span className="text-[11.5px]" style={{ color: "var(--color-gold)" }}>
                {pending.length > 0 ? `Resuelve los ${pending.length} código(s) pendientes` : `Marca qué sale en ${pendingWarranty} garantía(s)`} antes de guardar.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Un ID de Rocket que es un combo: Yair escribe el código del combo en Dropi.
// Si ya existe con su receta, se vincula; si no, registra la receta ahí mismo
// (una sola vez) y queda vinculado.
function RocketComboLink({
  initialCode,
  label,
  onLinked,
  onCancel,
}: {
  initialCode: string;
  label: string;
  onLinked: (comboCode: string, components: ComboPart[]) => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState(initialCode);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [register, setRegister] = useState(false);

  async function lookup(c: string) {
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/fulfillment-requests/combo?code=${encodeURIComponent(c.trim())}`);
    const json = await res.json().catch(() => null);
    setBusy(false);
    if (res.status === 404 || json?.kind === "comboNoRecipe") {
      setRegister(true);
      return;
    }
    if (!res.ok) {
      setErr(json?.error ?? "No se pudo buscar el combo.");
      return;
    }
    if (json.missingIds?.length > 0) {
      setErr(`Ese combo tiene productos sin ID de Dropi: ${json.missingIds.join(", ")}. Pide que se lo pongan y vuelve a intentar.`);
      return;
    }
    onLinked(json.comboCode, json.components);
  }

  if (register) {
    return (
      <div>
        <div className="text-[11px] mb-1.5" style={{ color: "var(--color-gold)" }}>
          El combo {code} todavía no tiene receta — regístrala una sola vez:
        </div>
        <RegisterComboForm initialCode={code.trim()} initialLabel={label} onRegistered={(c) => lookup(c.code)} onCancel={onCancel} />
      </div>
    );
  }

  return (
    <div className="bg-cloud rounded-md p-2.5 flex items-center gap-2 flex-wrap text-[11.5px]">
      <span>Código de este combo en Dropi:</span>
      <input
        type="text"
        inputMode="numeric"
        className="w-28 rounded border border-rule bg-surface px-2 py-1 font-mono"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && code.trim() && lookup(code)}
      />
      <button type="button" disabled={busy || !code.trim()} className="font-semibold text-teal cursor-pointer disabled:opacity-40" onClick={() => lookup(code)}>
        {busy ? "Buscando…" : "Vincular"}
      </button>
      <button type="button" className="text-steel cursor-pointer" onClick={onCancel}>
        Cancelar
      </button>
      {err && <div className="w-full text-red text-[11px]">{err}</div>}
    </div>
  );
}
