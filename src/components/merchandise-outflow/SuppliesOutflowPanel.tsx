"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Copy, ScanLine, Search } from "lucide-react";
import { LiveBarcodeScanner } from "@/components/shared/LiveBarcodeScanner";
import { formatDateTime } from "@/lib/formatDateTime";

// Pedido de Daniel 2026-10-16: salida directa de suministros — escanear el
// QR o buscar por nombre/ID, poner cantidad y registrar. Sin foto ni archivo.

type Supply = { id: string; name: string; justCode: string | null; photo: string | null; stock: number };
type Recent = { code: string; createdAt: string; by: string | null; name: string; quantity: number };

// Cómo se cuenta cada suministro (regla de Daniel): un paquete de fundas son
// 100 unidades, el plástico film va 1 por unidad y el rollo de burbuja se
// cuenta en metros (un rollo = 100 m).
function countingRule(name: string): { unit: string; pack?: { label: string; size: number } ; hint?: string } {
  const n = name.toLowerCase();
  if (n.includes("burbuja")) return { unit: "metros", pack: { label: "1 rollo", size: 100 }, hint: "Se cuenta en metros: 1 rollo = 100 metros." };
  if (n.includes("funda")) return { unit: "unidades", pack: { label: "1 paquete", size: 100 }, hint: "1 paquete de fundas = 100 unidades." };
  if (n.includes("film")) return { unit: "unidades", hint: "El plástico film se cuenta 1 por unidad." };
  return { unit: "unidades" };
}

export const SUPPLIES_SHARE_MESSAGE = [
  "📦 Cómo registrar la salida de suministros en DAFLOW",
  "(Registro de Egresos → Suministros: escanea el QR o busca el nombre o ID)",
  "",
  "• Fundas: 1 paquete = 100 unidades. Si sacas 1 paquete, registra 100.",
  "• Plástico film: se cuenta 1 por unidad. Si sacas 1 rollo de film, registra 1.",
  "• Rollo de burbuja: se cuenta en metros, no por unidad. Si sacas 1 rollo, registra 100 (metros).",
  "",
  "Regístralo en el momento en que lo sacas de bodega. Se descuenta solo de INVESTOCK.",
].join("\n");

function normalize(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function SuppliesOutflowPanel() {
  const [supplies, setSupplies] = useState<Supply[] | null>(null);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [loadErr, setLoadErr] = useState("");
  const [query, setQuery] = useState("");
  const [scanning, setScanning] = useState(false);
  const [notFound, setNotFound] = useState("");
  const [current, setCurrent] = useState<Supply | null>(null);
  const [qty, setQty] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");
  const [copied, setCopied] = useState(false);

  async function load() {
    const res = await fetch("/api/merchandise-outflow/supplies", { cache: "no-store" });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) {
      setLoadErr(data?.error ?? "No se pudo cargar la lista de suministros.");
      return;
    }
    setSupplies(data.supplies);
    setRecent(data.recent);
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/merchandise-outflow/supplies", { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok || !data) setLoadErr(data?.error ?? "No se pudo cargar la lista de suministros.");
        else {
          setSupplies(data.supplies);
          setRecent(data.recent);
        }
      })
      .catch(() => !cancelled && setLoadErr("No se pudo cargar la lista de suministros."));
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!supplies) return [];
    const q = normalize(query.trim());
    if (!q) return supplies;
    return supplies.filter((s) => normalize(s.name).includes(q) || normalize(s.justCode ?? "").includes(q));
  }, [supplies, query]);

  function pick(s: Supply) {
    setCurrent(s);
    setQty("");
    setErr("");
    setDone("");
    setNotFound("");
  }

  function openCode(raw: string) {
    const code = raw.trim();
    const s = supplies?.find((x) => x.justCode === code || x.id === code || (x.justCode ?? "").toUpperCase() === code.toUpperCase());
    if (!s) {
      setCurrent(null);
      setNotFound(`El código ${code} no es un suministro registrado en INVESTOCK.`);
      return;
    }
    pick(s);
  }

  async function save() {
    if (!current) return;
    const n = Number(qty);
    if (!Number.isInteger(n) || n <= 0) {
      setErr("Escribe la cantidad que sacaste (un número entero mayor a 0).");
      return;
    }
    const rule = countingRule(current.name);
    if (n > current.stock && !window.confirm(`En INVESTOCK figuran ${current.stock} ${rule.unit} y vas a registrar ${n}. ¿Registrar de todas formas?`)) return;
    setSaving(true);
    setErr("");
    const res = await fetch("/api/merchandise-outflow/supplies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ catalogItemId: current.id, quantity: n }),
    });
    const data = await res.json().catch(() => null);
    setSaving(false);
    if (!res.ok) {
      setErr(data?.error ?? "No se pudo registrar la salida.");
      return;
    }
    setDone(`${data.code}: salida de ${n} ${rule.unit} de ${current.name} registrada. Quedan ${data.stock}.`);
    setCurrent(null);
    setQty("");
    setQuery("");
    await load();
  }

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(SUPPLIES_SHARE_MESSAGE);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  if (loadErr) return <div className="text-[12.5px] text-red">{loadErr}</div>;
  if (!supplies) return <div className="text-[12.5px] text-steel">Cargando suministros…</div>;

  const rule = current ? countingRule(current.name) : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="bg-surface border border-rule rounded-md p-3.5">
        <div className="flex items-start gap-2 mb-2">
          <div className="font-display font-bold text-[13.5px]">Cómo se cuenta cada suministro</div>
          <button type="button" onClick={copyMessage} className="ml-auto flex items-center gap-1 text-[12px] font-semibold text-teal cursor-pointer shrink-0">
            {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copiado" : "Copiar mensaje para el equipo"}
          </button>
        </div>
        <ul className="text-[12.5px] text-steel flex flex-col gap-1">
          <li><b className="text-ink">Fundas:</b> 1 paquete = 100 unidades. Si sacas 1 paquete, registra 100.</li>
          <li><b className="text-ink">Plástico film:</b> se cuenta 1 por unidad.</li>
          <li><b className="text-ink">Rollo de burbuja:</b> se cuenta en metros, no por unidad. 1 rollo = 100 metros.</li>
        </ul>
      </div>

      <div>
        <div className="flex flex-col sm:flex-row gap-2 mb-3">
          <button
            type="button"
            className="flex items-center justify-center gap-1.5 rounded border border-teal bg-teal px-3.5 py-2.5 text-[13px] font-bold text-navy cursor-pointer"
            onClick={() => {
              setNotFound("");
              setScanning(true);
            }}
          >
            <ScanLine size={15} /> Escanear QR
          </button>
          <div className="flex-1 flex items-center gap-2 rounded border border-rule bg-surface px-3 py-2">
            <Search size={14} className="text-steel shrink-0" />
            <input
              type="text"
              placeholder="Busca por nombre o ID (ej. FUN-SUM-006)…"
              className="flex-1 text-[13px] outline-none bg-transparent min-w-0"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        {scanning && (
          <div className="mb-3">
            <LiveBarcodeScanner
              onScanned={(code) => {
                setScanning(false);
                openCode(code);
              }}
              onCancel={() => setScanning(false)}
            />
          </div>
        )}

        {notFound && (
          <div className="mb-3 text-[12.5px] text-red flex items-start gap-1.5">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {notFound}
          </div>
        )}
        {done && (
          <div className="mb-3 text-[12.5px] text-teal flex items-start gap-1.5">
            <Check size={14} className="mt-0.5 shrink-0" /> {done}
          </div>
        )}

        {current && rule ? (
          <div className="bg-surface border border-teal/40 rounded-md p-3.5">
            <div className="flex items-start gap-3">
              {current.photo && <img src={current.photo} alt="" className="w-14 h-14 rounded object-cover shrink-0" />}
              <div className="min-w-0">
                <div className="font-bold text-[13.5px]">{current.name}</div>
                <div className="font-mono text-[11.5px] text-steel">{current.justCode ?? "Sin ID"}</div>
                <div className="text-[12px] text-steel mt-0.5">En INVESTOCK: {current.stock} {rule.unit}</div>
              </div>
            </div>
            {rule.hint && <div className="mt-3 text-[12.5px] font-semibold text-ink bg-teal/10 rounded px-2.5 py-1.5">{rule.hint}</div>}
            <label className="block mt-3 text-[12.5px] font-semibold">Cantidad que sacaste (en {rule.unit})</label>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <input
                type="number"
                inputMode="numeric"
                min={1}
                autoFocus
                className="w-28 rounded border border-rule bg-cloud px-2.5 py-2 text-[14px] font-bold"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
              <span className="text-[12.5px] text-steel">{rule.unit}</span>
              {rule.pack && (
                <button
                  type="button"
                  className="rounded border border-rule px-2.5 py-1.5 text-[12px] font-semibold cursor-pointer hover:border-teal"
                  onClick={() => setQty(String((Number(qty) || 0) + rule.pack!.size))}
                >
                  + {rule.pack.label} ({rule.pack.size})
                </button>
              )}
            </div>
            {err && <div className="mt-2 text-[12px] text-red">{err}</div>}
            <div className="mt-3 flex gap-2">
              <button type="button" disabled={saving} className="flex-1 rounded border border-teal bg-teal px-3 py-2.5 text-[13px] font-bold text-navy cursor-pointer disabled:opacity-60" onClick={save}>
                {saving ? "Registrando…" : "Registrar salida"}
              </button>
              <button type="button" className="rounded border border-rule px-3 py-2.5 text-[13px] font-semibold cursor-pointer" onClick={() => setCurrent(null)}>
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-rule border border-rule rounded-md bg-surface">
            {filtered.length === 0 && <div className="p-3 text-[12.5px] text-steel">No hay suministros con ese nombre o ID.</div>}
            {filtered.map((s) => (
              <button key={s.id} type="button" onClick={() => pick(s)} className="flex items-center gap-3 p-2.5 text-left cursor-pointer hover:bg-teal/5">
                {s.photo ? <img src={s.photo} alt="" className="w-10 h-10 rounded object-cover shrink-0" /> : <div className="w-10 h-10 rounded bg-rule shrink-0" />}
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold truncate">{s.name}</div>
                  <div className="font-mono text-[11px] text-steel">{s.justCode ?? "Sin ID"}</div>
                </div>
                <div className="text-[12px] text-steel shrink-0 text-right">
                  {s.stock} <span className="hidden sm:inline">{countingRule(s.name).unit}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="font-display font-bold text-[14px] mb-2.5">Últimas salidas de suministros</div>
        {recent.length === 0 ? (
          <div className="text-[12.5px] text-steel">Todavía no hay salidas registradas.</div>
        ) : (
          <div className="flex flex-col divide-y divide-rule border border-rule rounded-md bg-surface">
            {recent.map((r) => (
              <div key={r.code} className="p-2.5 text-[12.5px] flex flex-wrap gap-x-3 gap-y-0.5">
                <span className="font-mono text-steel">{r.code}</span>
                <span className="font-semibold">{r.quantity} · {r.name}</span>
                <span className="text-steel sm:ml-auto">{r.by ?? "—"} · {formatDateTime(r.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
