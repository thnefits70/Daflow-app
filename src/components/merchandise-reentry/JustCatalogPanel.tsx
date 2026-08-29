"use client";

import { useEffect, useState } from "react";
import { Upload, CheckCircle2, AlertTriangle, Clock, Search, ChevronDown, ChevronUp } from "lucide-react";
import { uploadFile } from "@/lib/uploadFile";
import { CatalogCode, CopyCodeButton } from "@/components/shared/CatalogCode";

type CatalogItemDTO = { id: string; name: string; justCode: string | null; photos: string[]; pendingRegistration: boolean };
type ImportDTO = {
  id: string;
  importedAt: string;
  importedByName: string;
  totalRows: number;
  createdCount: number;
  linkedCount: number;
  renamedCount: number;
  duplicateGroupsTotal: number;
  duplicateGroupsResolved: number;
  missingCount: number;
};
type LastImportDTO = ImportDTO | null;

type NameChangedRow = { code: string; itemId: string; currentName: string; justName: string };
type SuggestedLinkRow = { code: string; name: string; itemId: string; existingName: string; matchType: "exact" | "similar" };
type DuplicateGroupRow = { code: string; name: string; alreadyLinked: boolean; existingName: string | null };
type DuplicateGroup = { groupName: string; rows: DuplicateGroupRow[] };
type MissingItem = { id: string; name: string; justCode: string; hasPhotos: boolean };
type Preview = {
  totalRows: number;
  unchangedCount: number;
  newRows: { code: string; name: string }[];
  nameChangedRows: NameChangedRow[];
  suggestedLinkRows: SuggestedLinkRow[];
  duplicateGroups: DuplicateGroup[];
  missingItems: MissingItem[];
};

const DISTINCT = "__distinct__";

function fmt(iso: string) {
  return new Date(iso).toLocaleString("es-EC", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function JustCatalogPanel({ canManage }: { canManage: boolean }) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<CatalogItemDTO[]>([]);
  const [lastImport, setLastImport] = useState<LastImportDTO>(null);
  const [imports, setImports] = useState<ImportDTO[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [query, setQuery] = useState("");
  const [phase, setPhase] = useState<"idle" | "reading" | "preview" | "applying">("idle");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState("");
  const [showNewRows, setShowNewRows] = useState(false);
  const [showMissing, setShowMissing] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  function copyCode(code: string) {
    navigator.clipboard.writeText(code).catch(() => {});
    setCopiedCode(code);
    setTimeout(() => setCopiedCode((c) => (c === code ? null : c)), 1200);
  }

  // itemId -> true significa "usar el nombre de Just" (nameChanged) / "vincular" (suggestedLink)
  const [nameDecisions, setNameDecisions] = useState<Record<string, boolean>>({});
  const [linkDecisions, setLinkDecisions] = useState<Record<string, boolean>>({});
  // índice del grupo -> código elegido para mantener, o DISTINCT si son productos distintos
  const [duplicateDecisions, setDuplicateDecisions] = useState<Record<number, string>>({});

  function load() {
    fetch("/api/merchandise-reentry/just-catalog")
      .then((r) => (r.ok ? r.json() : { items: [], lastImport: null, imports: [] }))
      .then((data) => {
        setItems(data.items ?? []);
        setLastImport(data.lastImport ?? null);
        setImports(data.imports ?? []);
      })
      .catch(() => {
        setItems([]);
        setLastImport(null);
        setImports([]);
      })
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const q = query.trim().toLowerCase();
  const filtered = q ? items.filter((i) => i.name.toLowerCase().includes(q) || (i.justCode ?? "").toLowerCase().includes(q)) : items;

  async function handleFile(file: File) {
    setErr("");
    setToast("");
    setPhase("reading");
    const uploaded = await uploadFile(file, "just-catalog-import");
    if (!uploaded.ok) {
      setErr(uploaded.error);
      setPhase("idle");
      return;
    }
    const res = await fetch("/api/merchandise-reentry/just-catalog/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileUrl: uploaded.url }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(json?.error ?? "No se pudo leer el archivo.");
      setPhase("idle");
      return;
    }
    setPreview(json.preview);
    setWarnings(json.warnings ?? []);
    // Defaults: nombre nuevo diferente NO se aplica solo (mantener el actual
    // hasta que Daniel lo confirme); coincidencia EXACTA sí se vincula por
    // defecto (señal fuerte); coincidencia por PALABRAS PARECIDAS no se
    // vincula por defecto (más riesgo de ser dos productos distintos que
    // comparten palabras) — Daniel confirma activamente cada una.
    setNameDecisions(Object.fromEntries((json.preview.nameChangedRows as NameChangedRow[]).map((r) => [r.itemId, false])));
    setLinkDecisions(Object.fromEntries((json.preview.suggestedLinkRows as SuggestedLinkRow[]).map((r) => [r.itemId, r.matchType === "exact"])));
    setDuplicateDecisions({});
    setPhase("preview");
  }

  function cancelPreview() {
    setPreview(null);
    setPhase("idle");
    setErr("");
  }

  const pendingDuplicateGroups = preview ? preview.duplicateGroups.filter((_, gi) => !duplicateDecisions[gi]).length : 0;

  async function confirmApply() {
    if (!preview) return;
    setPhase("applying");
    setErr("");
    const duplicateGroupDecisions: { code: string; name: string }[] = [];
    let duplicateGroupsResolved = 0;
    preview.duplicateGroups.forEach((g, gi) => {
      const decision = duplicateDecisions[gi];
      if (!decision) return;
      duplicateGroupsResolved++;
      if (decision === DISTINCT) {
        g.rows.forEach((r) => {
          if (!r.alreadyLinked) duplicateGroupDecisions.push({ code: r.code, name: r.name });
        });
      } else {
        const row = g.rows.find((r) => r.code === decision);
        if (row && !row.alreadyLinked) duplicateGroupDecisions.push({ code: row.code, name: row.name });
      }
    });
    const res = await fetch("/api/merchandise-reentry/just-catalog/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        totalRows: preview.totalRows,
        newRows: preview.newRows,
        nameChangedDecisions: preview.nameChangedRows.map((r) => ({ itemId: r.itemId, code: r.code, justName: r.justName, useJustName: !!nameDecisions[r.itemId] })),
        suggestedLinkDecisions: preview.suggestedLinkRows.map((r) => ({ itemId: r.itemId, code: r.code, name: r.name, link: !!linkDecisions[r.itemId] })),
        duplicateGroupDecisions,
        duplicateGroupsTotal: preview.duplicateGroups.length,
        duplicateGroupsResolved,
        missingCount: preview.missingItems.length,
      }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(json?.error ?? "No se pudo aplicar la actualización.");
      setPhase("preview");
      return;
    }
    setPreview(null);
    setPhase("idle");
    setToast(`✅ Base de datos actualizada — ${json.createdCount} nuevos, ${json.linkedCount} vinculados, ${json.renamedCount} renombrados.`);
    load();
  }

  if (loading) return <div className="text-[13px] text-steel">Cargando…</div>;

  return (
    <div>
      <div className="bg-surface border border-rule rounded-md p-4 mb-4">
        <div className="text-[12.5px] text-steel mb-1">
          Código y nombre de cada producto tal como están en Just — se usa para que Compras y Reingreso sugieran siempre el nombre correcto, y para que un producto que aún no está registrado en DAFLOW se pueda matricular con fotos sin escribir el nombre a mano.
        </div>
        {canManage && (
          <div className="text-[12.5px] mb-2.5 bg-teal/10 border border-teal/25 rounded px-2.5 py-2">
            <b>Qué hacer aquí:</b> descarga desde Just el listado de código y nombre de producto (lunes, miércoles y sábado), guárdalo como Excel y súbelo con el botón de abajo. DAFLOW compara con lo que ya existe y solo te pide confirmar los casos dudosos — el resto se actualiza solo.
          </div>
        )}
        {lastImport ? (
          <div className="flex items-center gap-1.5 text-[11.5px] text-teal">
            <CheckCircle2 size={13} />
            Última actualización: {fmt(lastImport.importedAt)} por {lastImport.importedByName} — {lastImport.createdCount} nuevos, {lastImport.linkedCount} vinculados, {lastImport.renamedCount} renombrados.
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-[11.5px] text-steel">
            <AlertTriangle size={13} /> Todavía no se ha subido ninguna base de datos.
          </div>
        )}
        {imports.length > 0 && (
          <div className="mt-1.5">
            <button
              type="button"
              className="flex items-center gap-1 text-[11px] font-semibold text-steel hover:text-teal cursor-pointer"
              onClick={() => setShowHistory((s) => !s)}
            >
              {showHistory ? <ChevronUp size={12} /> : <ChevronDown size={12} />} Historial de actualizaciones ({imports.length})
            </button>
            {showHistory && (
              <div className="mt-2 flex flex-col gap-1 max-h-48 overflow-y-auto">
                {imports.map((imp) => (
                  <div key={imp.id} className="text-[11px] text-steel flex flex-wrap items-center gap-x-1.5">
                    <span className="font-mono">{fmt(imp.importedAt)}</span>
                    <span>—</span>
                    <span className="font-semibold text-ink">{imp.importedByName}</span>
                    <span>· {imp.totalRows} filas, {imp.createdCount} nuevos, {imp.linkedCount} vinculados, {imp.renamedCount} renombrados</span>
                    {imp.duplicateGroupsTotal > 0 && (
                      <span style={{ color: "#D9A441" }}>
                        · {imp.duplicateGroupsResolved}/{imp.duplicateGroupsTotal} nombres repetidos resueltos
                        {imp.duplicateGroupsResolved < imp.duplicateGroupsTotal ? " (quedaron pendientes)" : ""}
                      </span>
                    )}
                    {imp.missingCount > 0 && <span style={{ color: "#D9A441" }}>· {imp.missingCount} ya no aparecían en Just</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {canManage && <div className="text-[10.5px] text-steel mt-1">Se puede actualizar lunes, miércoles y sábado con el export de Just.</div>}
      </div>

      {toast && <div className="flex items-center gap-2 text-teal text-[12.5px] bg-teal/10 border border-teal/30 rounded-md px-3 py-2 mb-4"><CheckCircle2 size={14} /> {toast}</div>}
      {err && <div className="text-red text-[12.5px] mb-3">{err}</div>}

      {canManage && phase === "idle" && (
        <label
          className={`flex flex-col items-center justify-center gap-1.5 border-[1.5px] border-dashed rounded-md py-6 cursor-pointer transition-colors mb-5 ${dragOver ? "border-teal bg-teal/10" : "border-rule hover:border-teal"}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) handleFile(file);
          }}
        >
          <Upload size={20} className="text-steel" />
          <div className="text-[13px] font-semibold">Subir base de datos de Just</div>
          <div className="text-[11px] text-steel">Formato .xlsx o .xls — código del producto y nombre/descripción, o arrastra el archivo aquí</div>
          <input type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
        </label>
      )}

      {phase === "reading" && (
        <div className="flex items-center justify-center gap-2.5 py-6 text-steel text-[13px] mb-5">
          <span className="w-4 h-4 rounded-full border-2 border-rule border-t-teal animate-spin" /> Leyendo archivo…
        </div>
      )}

      {(phase === "preview" || phase === "applying") && preview && (
        <div className="bg-surface border border-rule rounded-md p-4 mb-5">
          <div className="font-display font-bold text-[14.5px] mb-3">Revisa antes de aplicar</div>

          <div className="flex flex-wrap gap-2 mb-3.5">
            <span className="font-mono text-[10.5px] bg-cloud rounded-full px-2.5 py-1">{preview.unchangedCount} sin cambios</span>
            <span className="font-mono text-[10.5px] bg-teal/15 border border-teal/40 text-teal rounded-full px-2.5 py-1">{preview.newRows.length} nuevos (se crean automático, sin fotos)</span>
            {(preview.nameChangedRows.length > 0 || preview.suggestedLinkRows.length > 0 || preview.duplicateGroups.length > 0) && (
              <span className="font-mono text-[10.5px] bg-gold/15 border border-gold/40 rounded-full px-2.5 py-1" style={{ color: "#D9A441" }}>
                {preview.nameChangedRows.length + preview.suggestedLinkRows.length + preview.duplicateGroups.length} necesitan tu decisión
              </span>
            )}
          </div>

          {preview.duplicateGroups.length > 0 && (
            <div className="mb-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-1.5">Mismo nombre repetido en el archivo de Just — elige uno por grupo</div>
              <div className="flex flex-col gap-2">
                {preview.duplicateGroups.map((g, gi) => (
                  <div key={gi} className="bg-cloud rounded-md p-2.5">
                    <div className="text-[11.5px] mb-1.5">
                      <b>&quot;{g.groupName}&quot;</b> aparece {g.rows.length} veces en Just con códigos distintos — revisa si es el mismo producto repetido por error (corrígelo en Just después) o si de verdad son productos distintos.
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {g.rows.map((r) => (
                        <div
                          key={r.code}
                          className={`flex items-center rounded-full border ${duplicateDecisions[gi] === r.code ? "border-teal text-teal bg-teal/15" : "border-rule text-steel"}`}
                        >
                          <button
                            type="button"
                            className="text-[11px] font-semibold pl-2.5 pr-1.5 py-1 cursor-pointer"
                            onClick={() => setDuplicateDecisions((d) => ({ ...d, [gi]: r.code }))}
                          >
                            Mantener {r.code}{r.alreadyLinked ? ` (ya existe: ${r.existingName})` : ""}
                          </button>
                          <CopyCodeButton code={r.code} copied={copiedCode === r.code} onCopy={copyCode} />
                          <span className="pr-2" />
                        </div>
                      ))}
                      <button
                        type="button"
                        className={`text-[11px] font-semibold rounded-full px-2.5 py-1 border cursor-pointer ${duplicateDecisions[gi] === DISTINCT ? "border-teal text-teal bg-teal/15" : "border-rule text-steel"}`}
                        onClick={() => setDuplicateDecisions((d) => ({ ...d, [gi]: DISTINCT }))}
                      >
                        Son productos distintos
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {warnings.length > 0 && (
            <div className="flex flex-col gap-1 mb-3.5">
              {warnings.map((w, i) => (
                <div key={i} className="text-[11.5px] flex items-start gap-1.5 text-steel">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {w}
                </div>
              ))}
            </div>
          )}

          {preview.nameChangedRows.length > 0 && (
            <div className="mb-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-1.5">El nombre en Just cambió</div>
              <div className="flex flex-col gap-2">
                {preview.nameChangedRows.map((r) => (
                  <div key={r.itemId} className="bg-cloud rounded-md p-2.5">
                    <div className="text-[11.5px] mb-1.5 flex items-center gap-1 flex-wrap">
                      <span className="font-mono text-steel">{r.code}</span>
                      <CopyCodeButton code={r.code} copied={copiedCode === r.code} onCopy={copyCode} />
                      <span>— actual: <b>{r.currentName}</b> → Just: <b>{r.justName}</b></span>
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        className={`text-[11px] font-semibold rounded-full px-2.5 py-1 border cursor-pointer ${!nameDecisions[r.itemId] ? "border-teal text-teal bg-teal/15" : "border-rule text-steel"}`}
                        onClick={() => setNameDecisions((d) => ({ ...d, [r.itemId]: false }))}
                      >
                        Mantener nombre actual
                      </button>
                      <button
                        type="button"
                        className={`text-[11px] font-semibold rounded-full px-2.5 py-1 border cursor-pointer ${nameDecisions[r.itemId] ? "border-teal text-teal bg-teal/15" : "border-rule text-steel"}`}
                        onClick={() => setNameDecisions((d) => ({ ...d, [r.itemId]: true }))}
                      >
                        Usar nombre de Just
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {preview.suggestedLinkRows.length > 0 && (
            <div className="mb-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-1.5">Posible coincidencia con un producto existente</div>
              <div className="flex flex-col gap-2">
                {preview.suggestedLinkRows.map((r) => (
                  <div key={r.itemId} className="bg-cloud rounded-md p-2.5">
                    <div className="text-[11.5px] mb-1.5 flex items-center gap-1 flex-wrap">
                      <span className="font-mono text-steel">{r.code}</span>
                      <CopyCodeButton code={r.code} copied={copiedCode === r.code} onCopy={copyCode} />
                      <span>— <b>{r.name}</b> coincide con <b>{r.existingName}</b> (sin código de Just todavía)</span>
                      {r.matchType === "exact" ? (
                        <span className="ml-1.5 font-mono text-[9px] font-bold uppercase rounded-full px-1.5 py-0.5 bg-teal/15 border border-teal/40 text-teal">Nombre idéntico</span>
                      ) : (
                        <span className="ml-1.5 font-mono text-[9px] font-bold uppercase rounded-full px-1.5 py-0.5 bg-gold/15 border border-gold/40" style={{ color: "#D9A441" }}>Palabras parecidas — revisa</span>
                      )}
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        className={`text-[11px] font-semibold rounded-full px-2.5 py-1 border cursor-pointer ${linkDecisions[r.itemId] ? "border-teal text-teal bg-teal/15" : "border-rule text-steel"}`}
                        onClick={() => setLinkDecisions((d) => ({ ...d, [r.itemId]: true }))}
                      >
                        Vincular — es el mismo producto
                      </button>
                      <button
                        type="button"
                        className={`text-[11px] font-semibold rounded-full px-2.5 py-1 border cursor-pointer ${!linkDecisions[r.itemId] ? "border-teal text-teal bg-teal/15" : "border-rule text-steel"}`}
                        onClick={() => setLinkDecisions((d) => ({ ...d, [r.itemId]: false }))}
                      >
                        Son productos distintos
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {preview.newRows.length > 0 && (
            <div className="mb-4">
              <button type="button" className="flex items-center gap-1.5 text-[11px] font-semibold text-steel hover:text-teal cursor-pointer" onClick={() => setShowNewRows((s) => !s)}>
                {showNewRows ? <ChevronUp size={13} /> : <ChevronDown size={13} />} Ver los {preview.newRows.length} productos nuevos
              </button>
              {showNewRows && (
                <div className="mt-2 max-h-56 overflow-y-auto flex flex-col gap-1">
                  {preview.newRows.map((r) => (
                    <div key={r.code} className="text-[11.5px] flex items-center gap-1">
                      <span className="font-mono text-steel">{r.code}</span>
                      <CopyCodeButton code={r.code} copied={copiedCode === r.code} onCopy={copyCode} />
                      <span className="ml-1">{r.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {preview.missingItems.length > 0 && (
            <div className="mb-4">
              <button type="button" className="flex items-center gap-1.5 text-[11px] font-semibold text-steel hover:text-teal cursor-pointer" onClick={() => setShowMissing((s) => !s)}>
                {showMissing ? <ChevronUp size={13} /> : <ChevronDown size={13} />} {preview.missingItems.length} producto(s) ya no aparecen en este archivo de Just — revisar
              </button>
              {showMissing && (
                <div className="mt-2 max-h-56 overflow-y-auto flex flex-col gap-1">
                  <div className="text-[11px] text-steel mb-1">No se borran ni desvinculan solos — revisa en Just si fueron descontinuados o cambiaron de código.</div>
                  {preview.missingItems.map((m) => (
                    <div key={m.id} className="text-[11.5px] flex items-center gap-1">
                      <span className="font-mono text-steel">{m.justCode}</span>
                      <CopyCodeButton code={m.justCode} copied={copiedCode === m.justCode} onCopy={copyCode} />
                      <span className="ml-1">{m.name}</span>
                      {m.hasPhotos && (
                        <span className="font-mono text-[9px] font-bold uppercase rounded-full px-1.5 py-0.5 bg-teal/15 border border-teal/40 text-teal">Matriculado</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              disabled={phase === "applying" || pendingDuplicateGroups > 0}
              className="rounded border border-teal bg-teal px-3.5 py-2 text-[12.5px] font-bold text-navy cursor-pointer disabled:opacity-60"
              onClick={confirmApply}
            >
              {phase === "applying" ? "Aplicando…" : "Aplicar actualización"}
            </button>
            <button type="button" className="text-steel text-[12.5px] cursor-pointer" onClick={cancelPreview}>
              Cancelar
            </button>
            {pendingDuplicateGroups > 0 && (
              <span className="text-[11.5px]" style={{ color: "#D9A441" }}>
                Resuelve los {pendingDuplicateGroups} nombre(s) repetido(s) antes de aplicar.
              </span>
            )}
          </div>
        </div>
      )}

      <div className="relative mb-3">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-steel" />
        <input
          className="w-full max-w-sm rounded border border-rule pl-8.5 pr-3 py-2 text-[13px]"
          placeholder="Buscar por nombre o código"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5 max-h-[28rem] overflow-y-auto">
        {filtered.length === 0 && <div className="text-[12.5px] text-steel">Nada que mostrar.</div>}
        {filtered.map((item) => (
          <div key={item.id} className="flex items-center gap-2.5 bg-surface border border-rule rounded-md px-3 py-2">
            {item.photos[0] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.photos[0]}
                alt={item.name}
                className="w-8 h-8 object-cover rounded border border-rule shrink-0 cursor-zoom-in"
                onClick={() => setLightboxUrl(item.photos[0])}
              />
            ) : (
              <div className="w-8 h-8 rounded border border-dashed border-rule shrink-0 flex items-center justify-center text-steel">
                <Clock size={13} />
              </div>
            )}
            <CatalogCode code={item.justCode} />
            <span className="text-[12.5px] flex-1 min-w-0 truncate">{item.name}</span>
            {item.pendingRegistration && (
              <span className="shrink-0 font-mono text-[9px] font-bold uppercase rounded-full px-1.5 py-0.5 bg-gold/15 border border-gold/40" style={{ color: "#D9A441" }}>
                Pendiente de matricular
              </span>
            )}
          </div>
        ))}
      </div>

      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center cursor-zoom-out p-6"
          onClick={() => setLightboxUrl(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightboxUrl} alt="" className="max-w-[90vw] max-h-[90vh] object-contain rounded-md shadow-2xl" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}
