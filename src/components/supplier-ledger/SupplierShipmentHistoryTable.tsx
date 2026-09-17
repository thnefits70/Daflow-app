"use client";

import { useMemo, useState } from "react";

type HistoryRow = {
  id: string;
  confirmedAt: string; // ISO
  productName: string;
  productImageUrl: string | null;
  quantity: number;
  requestedByName: string | null;
  photoUrl: string | null;
};

type Props = {
  rows: HistoryRow[];
};

const DATETIME_FMT = new Intl.DateTimeFormat("es-EC", {
  timeZone: "America/Guayaquil",
  weekday: "short",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const MONTH_LABEL_FMT = new Intl.DateTimeFormat("es-EC", { timeZone: "America/Guayaquil", month: "long", year: "numeric" });
const DATE_KEY_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guayaquil", year: "numeric", month: "2-digit", day: "2-digit" });

// Confirmado 2026-09-17, pedido explícito del usuario: filtro por rango de
// fechas (desde/hasta), una fecha específica (llenando ambos igual), o por
// mes completo — el historial de "ya confirmaron enviado" va a ir creciendo
// con el tiempo. Filtra client-side sobre lo que ya se cargó (mismo patrón
// que los filtros de "Mis solicitudes" en Control de Compras), sin pedir
// nada nuevo al servidor. Las claves de fecha se calculan en la zona horaria
// de Guayaquil (no UTC) para que un "desde"/"hasta" elegido en el date
// picker corresponda al día real que la gente ve en la columna "Confirmado".
function dateKey(iso: string): string {
  return DATE_KEY_FMT.format(new Date(iso));
}

export function SupplierShipmentHistoryTable({ rows }: Props) {
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");

  const months = useMemo(() => {
    const set = new Set(rows.map((r) => dateKey(r.confirmedAt).slice(0, 7)));
    return Array.from(set)
      .sort()
      .reverse()
      .map((ym) => ({ value: ym, label: MONTH_LABEL_FMT.format(new Date(`${ym}-02T00:00:00`)) }));
  }, [rows]);

  function pickMonth(ym: string) {
    if (!ym) return;
    const [year, month] = ym.split("-").map(Number);
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    setDesde(`${ym}-01`);
    setHasta(`${ym}-${String(lastDay).padStart(2, "0")}`);
  }

  const filtered = rows.filter((r) => {
    const key = dateKey(r.confirmedAt);
    if (desde && key < desde) return false;
    if (hasta && key > hasta) return false;
    return true;
  });

  const th = "px-3 py-2 whitespace-nowrap";
  const td = "px-3 py-2 whitespace-nowrap";
  const NOMBRE_TH = "px-3 py-2 min-w-[200px]";

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-3 text-xs text-neutral-600">
        <label className="flex flex-col gap-1">
          <span>Desde</span>
          <input
            type="date"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
            onClick={(e) => e.currentTarget.showPicker?.()}
            className="rounded border border-neutral-300 px-2 py-1 text-sm cursor-pointer"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span>Hasta</span>
          <input
            type="date"
            value={hasta}
            onChange={(e) => setHasta(e.target.value)}
            onClick={(e) => e.currentTarget.showPicker?.()}
            className="rounded border border-neutral-300 px-2 py-1 text-sm cursor-pointer"
          />
        </label>
        {months.length > 0 && (
          <label className="flex flex-col gap-1">
            <span>O elegir un mes completo</span>
            <select
              defaultValue=""
              onChange={(e) => pickMonth(e.target.value)}
              className="rounded border border-neutral-300 px-2 py-1 text-sm capitalize"
            >
              <option value="">Elegir mes…</option>
              {months.map((m) => (
                <option key={m.value} value={m.value} className="capitalize">
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {(desde || hasta) && (
          <button
            type="button"
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50"
            onClick={() => {
              setDesde("");
              setHasta("");
            }}
          >
            Quitar filtro
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-neutral-400">
          {rows.length === 0 ? "Todavía no han confirmado ningún envío." : "No hay envíos confirmados en ese rango de fechas."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className={th}>Confirmado</th>
                <th className={th}>Imagen</th>
                <th className={NOMBRE_TH}>Producto</th>
                <th className={`${th} text-right`}>Cant.</th>
                <th className={th}>Solicitado por</th>
                <th className={th}>Foto de envío</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td className={`${td} text-neutral-600`}>{DATETIME_FMT.format(new Date(r.confirmedAt))}</td>
                  <td className="px-3 py-2">
                    {r.productImageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.productImageUrl} alt={r.productName} className="w-12 h-12 object-cover rounded-md border border-neutral-200" />
                    ) : (
                      <span className="text-neutral-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">{r.productName}</td>
                  <td className={`${td} text-right tabular-nums`}>{r.quantity}</td>
                  <td className={`${td} text-neutral-600`}>{r.requestedByName ?? "—"}</td>
                  <td className="px-3 py-2">
                    {r.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.photoUrl} alt="Foto enviada" className="w-16 h-16 object-cover rounded-md border border-neutral-200" />
                    ) : (
                      <span className="text-neutral-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
