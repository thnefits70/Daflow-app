"use client";

import { useState } from "react";
import { Camera, AlertTriangle, Package, X } from "lucide-react";
import { uploadFile } from "@/lib/uploadFile";
import { ProductMatchPicker, type MatchCatalogItem } from "@/components/merchandise-reentry/ProductMatchPicker";
import { CatalogCode } from "@/components/shared/CatalogCode";
import { RegisterComboForm } from "./RegisterComboForm";

type Confidence = "alta" | "media" | "baja";
type CatalogItemLite = { id: string; name: string; photos: string[]; justCode: string | null; pendingRegistration: boolean };
type OutflowRowGroup = {
  name: string;
  quantity: number;
  confidence: Confidence;
  catalogItem: CatalogItemLite | null;
  sourceCode: string | null;
  fromCombo: string | null;
  comboUnits: number | null;
};
type Preview = {
  rows: OutflowRowGroup[];
  excludedNoStock: { name: string; code: string | null }[];
  combosMissingRecipe: { code: string; name: string; quantity: number }[];
};

const CONFIDENCE_LABEL: Record<Confidence, string> = { alta: "Lectura clara", media: "Revisar: letra poco clara", baja: "Revisar: dudosa" };
const CONFIDENCE_STYLE: Record<Confidence, string> = {
  alta: "bg-green/10 text-green border-green/35",
  media: "bg-yellow/10 text-yellow border-yellow/35",
  baja: "bg-red/10 text-red border-red/35",
};

type Decision = { catalogItem: MatchCatalogItem | null; skip: boolean };

export function DropiRequestPanel({ onApplied }: { onApplied: (batchId: string) => void }) {
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [phase, setPhase] = useState<"idle" | "reading" | "preview" | "applying">("idle");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [decisions, setDecisions] = useState<Record<number, Decision>>({});
  const [pickingIndex, setPickingIndex] = useState<number | null>(null);
  const [registeringCombo, setRegisteringCombo] = useState<string | null>(null);
  const [err, setErr] = useState("");

  async function handleFiles(files: FileList) {
    setErr("");
    setUploading(true);
    const urls: string[] = [];
    for (const file of Array.from(files)) {
      const uploaded = await uploadFile(file, "dropi-request-screenshots");
      if (!uploaded.ok) {
        setErr(uploaded.error);
        continue;
      }
      urls.push(uploaded.url);
    }
    setPhotos((p) => [...p, ...urls]);
    setUploading(false);
  }

  async function readDocument() {
    if (photos.length === 0) return;
    setErr("");
    setPhase("reading");
    const res = await fetch("/api/fulfillment-requests/dropi/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photoUrls: photos }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(json?.error ?? "No se pudo leer el documento.");
      setPhase("idle");
      return;
    }
    const p = json as Preview;
    setPreview(p);
    const initial: Record<number, Decision> = {};
    p.rows.forEach((r, i) => {
      initial[i] = { catalogItem: r.catalogItem, skip: false };
    });
    setDecisions(initial);
    setPhase("preview");
  }

  function cancelPreview() {
    setPreview(null);
    setPhotos([]);
    setPhase("idle");
    setErr("");
  }

  const pendingCount = preview ? preview.rows.filter((_, i) => !decisions[i]?.catalogItem && !decisions[i]?.skip).length : 0;

  async function confirmApply() {
    if (!preview) return;
    setPhase("applying");
    setErr("");
    const rows: { catalogItemId: string; quantity: number; sourceCode: string | null; fromComboCode: string | null }[] = [];
    let skippedCount = preview.excludedNoStock.length;
    preview.rows.forEach((r, i) => {
      const d = decisions[i];
      if (!d) return;
      if (d.skip || !d.catalogItem) {
        skippedCount++;
        return;
      }
      rows.push({ catalogItemId: d.catalogItem.id, quantity: r.quantity, sourceCode: r.sourceCode, fromComboCode: r.fromCombo });
    });

    const res = await fetch("/api/fulfillment-requests/dropi/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ totalRows: preview.rows.length + preview.excludedNoStock.length, rows, skippedCount }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(json?.error ?? "No se pudo aplicar la lectura.");
      setPhase("preview");
      return;
    }
    setPreview(null);
    setPhotos([]);
    setPhase("idle");
    onApplied(json.batchId);
  }

  return (
    <div>
      <div className="text-[12.5px] mb-3 bg-teal/10 border border-teal/25 rounded px-2.5 py-2">
        <b>Dropi:</b> toma captura de pantalla del manifiesto tal como lo genera Dropi, ANTES de que alguien lo resalte con marcador o lo corrija a mano — mientras más limpia la imagen, mejor lee la IA. Los combos se calculan solos con la receta ya registrada, no hace falta que corrijas la cantidad.
      </div>

      {phase === "idle" && (
        <>
          {photos.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {photos.map((url, i) => (
                <div key={url} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" className="w-16 h-16 object-cover rounded border border-rule" />
                  <button
                    type="button"
                    className="absolute -top-1.5 -right-1.5 bg-navy text-white rounded-full w-5 h-5 flex items-center justify-center cursor-pointer"
                    onClick={() => setPhotos((p) => p.filter((_, idx) => idx !== i))}
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <label className="flex flex-col items-center justify-center gap-1.5 border-[1.5px] border-dashed border-rule hover:border-teal rounded-md py-6 cursor-pointer transition-colors mb-3">
            <Camera size={20} className="text-steel" />
            <div className="text-[13px] font-semibold">{uploading ? "Subiendo…" : "Subir captura(s) del manifiesto"}</div>
            <div className="text-[11px] text-steel">Puedes subir varias fotos si son varias hojas</div>
            <input type="file" accept="image/*" multiple className="hidden" disabled={uploading} onChange={(e) => e.target.files && handleFiles(e.target.files)} />
          </label>
          {photos.length > 0 && (
            <button type="button" className="rounded border border-teal bg-teal px-3.5 py-2 text-[12.5px] font-bold text-navy cursor-pointer mb-5" onClick={readDocument}>
              Leer documento ({photos.length} foto{photos.length === 1 ? "" : "s"})
            </button>
          )}
        </>
      )}

      {phase === "reading" && (
        <div className="flex items-center justify-center gap-2.5 py-6 text-steel text-[13px] mb-5">
          <span className="w-4 h-4 rounded-full border-2 border-rule border-t-teal animate-spin" /> Leyendo documento…
        </div>
      )}

      {err && <div className="text-red text-[12.5px] mb-3">{err}</div>}

      {(phase === "preview" || phase === "applying") && preview && (
        <div className="bg-surface border border-rule rounded-md p-4 mb-5">
          <div className="font-display font-bold text-[14.5px] mb-3">Revisa antes de aplicar</div>

          {preview.combosMissingRecipe.map((c) => (
            <div key={c.code} className="text-[11.5px] mb-3 bg-red/10 border border-red/30 rounded-md p-2.5">
              <div className="flex items-start gap-1.5 mb-1.5">
                <AlertTriangle size={14} className="mt-0.5 shrink-0 text-red" />
                <span className="text-red">
                  <b>{c.name}</b> (código {c.code}, pedido {c.quantity}x) no tiene receta registrada — sus productos NO aparecen en la lista de abajo hasta que la registres.
                </span>
              </div>
              {registeringCombo === c.code ? (
                <RegisterComboForm
                  initialCode={c.code}
                  initialLabel={c.name}
                  onRegistered={() => {
                    setRegisteringCombo(null);
                    readDocument();
                  }}
                  onCancel={() => setRegisteringCombo(null)}
                />
              ) : (
                <button type="button" className="text-[11px] font-semibold text-teal cursor-pointer" onClick={() => setRegisteringCombo(c.code)}>
                  Registrar receta de este combo
                </button>
              )}
            </div>
          ))}

          {preview.excludedNoStock.length > 0 && (
            <div className="text-[11.5px] text-steel mb-3">
              {preview.excludedNoStock.length} producto(s) marcados &quot;NO HAY&quot; en el documento — no se incluyen en la lista: {preview.excludedNoStock.map((r) => r.name).join(", ")}.
            </div>
          )}

          {pendingCount > 0 && (
            <div className="mb-3 font-mono text-[10.5px] bg-gold/15 border border-gold/40 rounded-full px-2.5 py-1 inline-block" style={{ color: "#D9A441" }}>
              {pendingCount} necesitan que busques el producto
            </div>
          )}

          <div className="flex flex-col gap-2 mb-3">
            {preview.rows.map((r, i) => {
              const d = decisions[i] ?? { catalogItem: null, skip: false };
              const resolved = !!d.catalogItem || d.skip;
              return (
                <div key={i} className={`rounded-md p-2.5 ${resolved ? "bg-cloud" : "bg-gold/10 border border-gold/30"}`}>
                  <div className="text-[11.5px] mb-1 flex items-center gap-1.5 flex-wrap">
                    <span className={`font-mono text-[9px] font-bold uppercase rounded-full px-1.5 py-0.5 border ${CONFIDENCE_STYLE[r.confidence]}`}>{CONFIDENCE_LABEL[r.confidence]}</span>
                    {r.fromCombo && (
                      <span className="font-mono text-[9px] font-bold uppercase rounded-full px-1.5 py-0.5 bg-gold/15 border border-gold/40" style={{ color: "#D9A441" }}>
                        Combo {r.fromCombo} × {r.comboUnits}
                      </span>
                    )}
                    <span>
                      <b>{r.name}</b> — cantidad: <b>{r.quantity}</b>
                    </span>
                  </div>

                  {d.catalogItem ? (
                    <div className="text-[11.5px] flex items-center gap-1.5">
                      {d.catalogItem.photos[0] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={d.catalogItem.photos[0]} alt="" className="w-6 h-6 object-cover rounded border border-rule" />
                      ) : (
                        <div className="w-6 h-6 rounded border border-dashed border-rule flex items-center justify-center text-steel">
                          <Package size={11} />
                        </div>
                      )}
                      <CatalogCode code={d.catalogItem.justCode} />
                      <span>{d.catalogItem.name}</span>
                      <button
                        type="button"
                        className="text-steel hover:text-teal cursor-pointer ml-1"
                        onClick={() => setPickingIndex(i)}
                      >
                        Cambiar
                      </button>
                    </div>
                  ) : pickingIndex === i ? (
                    <ProductMatchPicker
                      referencePhotoUrl={null}
                      initialQuery={r.name}
                      searchUrl="/api/fulfillment-requests/catalog-search"
                      onConfirm={(item) => {
                        setDecisions((prev) => ({ ...prev, [i]: { catalogItem: item, skip: false } }));
                        setPickingIndex(null);
                      }}
                      onCancel={() => setPickingIndex(null)}
                    />
                  ) : registeringCombo === `row:${i}` ? (
                    <RegisterComboForm
                      initialCode={r.sourceCode ?? ""}
                      initialLabel={r.name}
                      onRegistered={() => {
                        setRegisteringCombo(null);
                        readDocument();
                      }}
                      onCancel={() => setRegisteringCombo(null)}
                    />
                  ) : (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] text-steel">Sin coincidencia en el catálogo.</span>
                      <button type="button" className="text-[11px] font-semibold text-teal cursor-pointer" onClick={() => setPickingIndex(i)}>
                        Buscar producto
                      </button>
                      <button type="button" className="text-[11px] font-semibold text-teal cursor-pointer" onClick={() => setRegisteringCombo(`row:${i}`)}>
                        ¿Es un combo nuevo?
                      </button>
                    </div>
                  )}

                  {!d.catalogItem && (
                    <button
                      type="button"
                      className={`text-[10.5px] mt-1.5 cursor-pointer ${d.skip ? "text-red font-semibold" : "text-steel hover:text-red"}`}
                      onClick={() => setDecisions((prev) => ({ ...prev, [i]: { catalogItem: null, skip: !d.skip } }))}
                    >
                      {d.skip ? "✓ Marcado como \"no es un producto\" (ignorar)" : "No es un producto — ignorar esta fila"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              disabled={phase === "applying" || pendingCount > 0 || preview.combosMissingRecipe.length > 0}
              className="rounded border border-teal bg-teal px-3.5 py-2 text-[12.5px] font-bold text-navy cursor-pointer disabled:opacity-60"
              onClick={confirmApply}
            >
              {phase === "applying" ? "Aplicando…" : "Confirmar y compendiar"}
            </button>
            <button type="button" className="text-steel text-[12.5px] cursor-pointer" onClick={cancelPreview}>
              Cancelar
            </button>
            {preview.combosMissingRecipe.length > 0 && (
              <span className="text-[11.5px] text-red">Registra la(s) receta(s) de combo pendientes antes de aplicar.</span>
            )}
            {pendingCount > 0 && (
              <span className="text-[11.5px]" style={{ color: "#D9A441" }}>
                Resuelve las {pendingCount} fila(s) pendientes antes de aplicar.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
