"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Upload } from "lucide-react";
import type { NickPayments as Payments, PaymentGuide } from "@/lib/nick/payments";
import { formatDateTime } from "@/lib/formatDateTime";

// NICK — cruce de pagos (2026-10-16): por ahora solo el admin sube el Excel
// "Historial de cartera" de Dropi y ve qué guías entregadas pagó Dropi.

const usd = (n: number) => `$${n.toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const monthLabel = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return `${MONTHS[mo - 1] ?? m} ${y}`;
};

function GuideTable({ rows, showPaid = false, showEst = false }: { rows: PaymentGuide[]; showPaid?: boolean; showEst?: boolean }) {
  if (!rows.length) return <div className="p-3 text-[12px] text-steel">Ninguna.</div>;
  return (
    <>
      <div className="overflow-auto max-h-[calc(100vh-190px)]">
        <table className="w-full text-[12px]">
          <thead className="sticky top-0 bg-surface z-[1]">
            <tr className="text-left text-steel font-mono text-[10px] uppercase tracking-wide">
              <th className="py-2 px-3">Guía</th>
              <th className="py-2 pr-3">Orden Dropi</th>
              <th className="py-2 pr-3">Fecha orden</th>
              <th className="py-2 pr-3">Estado</th>
              <th className="py-2 pr-3">Transportadora</th>
              <th className="py-2 pr-3">Ciudad</th>
              {showPaid && <th className="py-2 pr-3 text-right">Pagado</th>}
              {showPaid && <th className="py-2 pr-3 text-right">Pagos</th>}
              {showEst && <th className="py-2 pr-3 text-right" title="Precio Dropi del producto; si la guía no tiene corte guardado, lo que Dropi pagó en promedio por guía ese mes">Debería pagar (aprox.)</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.guideNumber} className="border-t border-rule">
                <td className="py-1.5 px-3 font-mono">{g.guideNumber}</td>
                <td className="py-1.5 pr-3 font-mono">{g.orderId}</td>
                <td className="py-1.5 pr-3 whitespace-nowrap">{g.orderDay ?? "—"}</td>
                <td className="py-1.5 pr-3">{g.status}</td>
                <td className="py-1.5 pr-3">{g.carrier ?? "—"}</td>
                <td className="py-1.5 pr-3">{g.city ?? "—"}</td>
                {showPaid && <td className="py-1.5 pr-3 text-right tabular-nums">{usd(g.paid)}</td>}
                {showPaid && <td className="py-1.5 pr-3 text-right tabular-nums">{g.payments}</td>}
                {showEst && <td className="py-1.5 pr-3 text-right tabular-nums">{g.estValue == null ? "—" : usd(g.estValue)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function NickPayments({ accounts }: { accounts: { id: string; name: string }[] }) {
  const [account, setAccount] = useState("");
  const [month, setMonth] = useState("");
  const [data, setData] = useState<Payments | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [upAccount, setUpAccount] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [upMsg, setUpMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [tab, setTab] = useState<"unpaid" | "twice" | "returned" | "indem">("unpaid");

  const url = useMemo(() => {
    const p = new URLSearchParams({ k: String(reloadKey) });
    if (account) p.set("account", account);
    if (month) p.set("month", month);
    return `/api/nick/payments?${p.toString()}`;
  }, [account, month, reloadKey]);
  const load = useCallback(() => {
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Payments | null) => d && setData(d))
      .finally(() => setLoading(false));
  }, [url]);
  useEffect(load, [load]);

  const upload = async () => {
    if (!file || !upAccount) return;
    setUploading(true);
    setUpMsg(null);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("account", upAccount);
    const res = await fetch("/api/nick/payments", { method: "POST", body: fd });
    const d = await res.json().catch(() => ({}));
    if (res.ok) {
      setUpMsg({
        ok: true,
        text: `Listo: ${d.inserted} movimientos de ${d.month ? monthLabel(d.month) : "?"}${d.repeated ? ` (${d.repeated} ya estaban)` : ""}. Se ignoraron ${d.skipped} retiros y transferencias.`,
      });
      setAccount(upAccount);
      setMonth(d.month ?? "");
      setFile(null);
      setLoading(true);
      setReloadKey((k) => k + 1);
    } else setUpMsg({ ok: false, text: d.error ?? "No se pudo subir el archivo." });
    setUploading(false);
  };

  const accName = (id: string | null) => accounts.find((a) => a.id === id)?.name ?? "—";

  const tabs = data
    ? ([
        ["unpaid", `Entregadas sin pagar (${data.unpaid.length})`],
        ["twice", `Posibles pagos repetidos (${data.paidTwice.length})`],
        ["returned", `Pagadas pero devueltas (${data.paidReturned.length})`],
        ["indem", `Indemnizaciones (${data.indemnities.length})`],
      ] as const)
    : [];

  // 2026-10-17: en pantallas anchas, totales a la izquierda y la lista a la
  // derecha con su propio desplazamiento, para no bajar por toda la página.
  return (
    <div className="mb-8 grid gap-4 xl:grid-cols-[400px_minmax(0,1fr)] items-start">
      <div className="flex flex-col gap-3 min-w-0">
        <div className="font-mono text-[10.5px] tracking-[.14em] uppercase text-steel">Pagos de Dropi · solo lo ves tú</div>

        <div className="bg-surface border border-rule rounded-lg p-3">
          <div className="text-[13px] font-semibold mb-0.5">Subir Historial de cartera</div>
          <div className="text-[11px] text-steel mb-2">
            Del mes anterior completo, entre el 20 y el fin de mes. Los retiros y transferencias se ignoran: no se guardan.
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <select value={upAccount} onChange={(e) => setUpAccount(e.target.value)} className="bg-surface border border-rule rounded px-2 py-1.5">
              <option value="">¿De qué cuenta es?</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <input type="file" accept=".xlsx,.xls" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-[12px] max-w-full" />
            <button
              type="button"
              onClick={upload}
              disabled={!file || !upAccount || uploading}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue text-white px-3 py-1.5 text-[12.5px] font-semibold cursor-pointer disabled:opacity-50"
            >
              <Upload size={13} /> {uploading ? "Subiendo…" : "Subir"}
            </button>
          </div>
          {upMsg && <div className={`mt-2 text-[12px] ${upMsg.ok ? "text-green" : "text-red"}`}>{upMsg.text}</div>}
        </div>

        {data && data.uploads.length > 0 && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              <select
                value={data.account ?? ""}
                onChange={(e) => {
                  setAccount(e.target.value);
                  setMonth("");
                  setLoading(true);
                }}
                className="bg-surface border border-rule rounded px-2 py-1.5"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <select
                value={data.month ?? ""}
                onChange={(e) => {
                  setMonth(e.target.value);
                  setLoading(true);
                }}
                className="bg-surface border border-rule rounded px-2 py-1.5"
              >
                {data.months.length === 0 && <option value="">Sin archivos de esta cuenta</option>}
                {data.months.map((m) => (
                  <option key={m} value={m}>
                    Órdenes de {monthLabel(m)}
                  </option>
                ))}
              </select>
              {loading && <span className="text-steel">Calculando…</span>}
            </div>

            {data.month && (
              <>
                <div className={`grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-2 gap-2 ${loading ? "opacity-60" : ""}`}>
                  <div className="bg-surface border border-rule rounded-lg p-3">
                    <div className="text-[11px] text-steel">✅ Entregadas y pagadas</div>
                    <div className="font-display text-[22px] font-bold tabular-nums">
                      {data.counts.deliveredPaid.toLocaleString("es-EC")} <span className="text-[13px] text-steel">de {data.counts.delivered.toLocaleString("es-EC")}</span>
                    </div>
                    <div className="text-[10.5px] text-steel">Pagado: {usd(data.amounts.paid)}</div>
                  </div>
                  <div className="bg-surface border border-amber/50 rounded-lg p-3">
                    <div className="text-[11px] text-steel">⚠️ Entregadas sin pagar</div>
                    <div className="font-display text-[22px] font-bold tabular-nums text-amber">{data.counts.deliveredUnpaid.toLocaleString("es-EC")}</div>
                    <div className="text-[10.5px] text-steel">Aprox. {usd(data.amounts.unpaidEstimate)} por reclamar</div>
                    {data.counts.deliveredWaiting > 0 && (
                      <div className="text-[10.5px] text-steel">⏳ {data.counts.deliveredWaiting.toLocaleString("es-EC")} más esperan el archivo del mes siguiente</div>
                    )}
                  </div>
                  <div className="bg-surface border border-rule rounded-lg p-3">
                    <div className="text-[11px] text-steel">🔁 Posibles pagos repetidos</div>
                    <div className="font-display text-[22px] font-bold tabular-nums">{data.counts.paidTwice.toLocaleString("es-EC")}</div>
                    <div className="text-[10.5px] text-steel">↩️ Pagadas pero devueltas: {data.counts.paidReturned}</div>
                  </div>
                  <div className="bg-surface border border-rule rounded-lg p-3">
                    <div className="text-[11px] text-steel">💵 Indemnizaciones del mes</div>
                    <div className="font-display text-[22px] font-bold tabular-nums">{usd(data.amounts.indemnIn - data.amounts.indemnOut)}</div>
                    <div className="text-[10.5px] text-steel">
                      🧾 Cobros por garantías: {usd(data.amounts.warrantyCharges)}
                      {data.amounts.rejected ? ` · Rechazados: ${usd(data.amounts.rejected)}` : ""}
                    </div>
                  </div>
                </div>
                <div className="text-[10.5px] text-steel leading-snug">
                  Se cruza por número de guía con todos los archivos subidos de esta cuenta. &quot;Sin pagar&quot; solo cuenta órdenes que ya debieron pagarse dentro
                  de los archivos subidos; las de los últimos días esperan el archivo del mes siguiente. Varios pagos de una guía a la misma hora son un pago por
                  producto, no un repetido.
                  {data.counts.paidNotInNick > 0 &&
                    ` ${data.counts.paidNotInNick} pagos de este mes son de guías que NICK no tiene (órdenes de otro mes o de antes de que NICK leyera esa fecha).`}
                </div>
              </>
            )}

            <div className="text-[10.5px] text-steel">
              Archivos subidos:{" "}
              {data.uploads
                .map((u) => `${accName(u.accountId)} · ${monthLabel(u.month)} · ${u.rows} movimientos (${formatDateTime(u.createdAt)})`)
                .join(" | ")}
            </div>
          </>
        )}
      </div>

      {data && data.uploads.length > 0 && data.month && (
        <div className="flex flex-col gap-2 min-w-0">
          <div className="flex flex-wrap gap-2">
            {tabs.map(([k, l]) => (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k)}
                className={`rounded-md border px-3 py-1.5 text-[12.5px] cursor-pointer ${tab === k ? "border-blue bg-blue/10 font-semibold" : "border-rule bg-surface"}`}
              >
                {l}
              </button>
            ))}
          </div>
          <div className="bg-surface border border-rule rounded-lg">
            {tab === "unpaid" && <GuideTable rows={data.unpaid} showEst />}
            {tab === "twice" && <GuideTable rows={data.paidTwice} showPaid />}
            {tab === "returned" && <GuideTable rows={data.paidReturned} showPaid />}
            {tab === "indem" &&
              (data.indemnities.length ? (
                <div className="overflow-auto max-h-[calc(100vh-190px)]">
                  <table className="w-full text-[12px]">
                    <thead className="sticky top-0 bg-surface z-[1]">
                      <tr className="text-left text-steel font-mono text-[10px] uppercase tracking-wide">
                        <th className="py-2 px-3">Fecha</th>
                        <th className="py-2 pr-3">Tipo</th>
                        <th className="py-2 pr-3 text-right">Monto</th>
                        <th className="py-2 pr-3">Orden</th>
                        <th className="py-2 pr-3">Motivo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.indemnities.map((i, n) => (
                        <tr key={n} className="border-t border-rule">
                          <td className="py-1.5 px-3 whitespace-nowrap">{formatDateTime(i.at)}</td>
                          <td className="py-1.5 pr-3">{i.direction === "SALIDA" ? "Te cobraron" : "Te pagaron"}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{usd(i.amount)}</td>
                          <td className="py-1.5 pr-3 font-mono">{i.orderId ?? "—"}</td>
                          <td className="py-1.5 pr-3">{i.description}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-3 text-[12px] text-steel">Ninguna este mes.</div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
