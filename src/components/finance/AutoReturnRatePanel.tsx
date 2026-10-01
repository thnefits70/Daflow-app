import { AlertTriangle } from "lucide-react";
import { formatMonthShort } from "@/components/dashboard/WeeklyTrendChart";
import {
  getAutoReturnRateMonths,
  getRecentReturnRate,
  HIGH_RETURN_MIN_OUT,
  HIGH_RETURN_PCT,
  RETURN_CLOSE_DAYS,
  RETURN_LAG_DAYS,
  type ReturnRateRow,
} from "@/lib/returnRate";

const PRODUCT_LIMIT = 25;

// perProduct: con pocas salidas el % engaña (ej. salió 1, regresaron 51 de
// ventas anteriores = "5100%") — se muestra "pocas salidas" en su lugar.
function Pct({ row, perProduct }: { row: ReturnRateRow; perProduct: boolean }) {
  if (row.pct === null) return <span className="text-steel">—</span>;
  if (perProduct && row.out < HIGH_RETURN_MIN_OUT) return <span className="text-[11px] text-steel">pocas salidas</span>;
  return (
    <span className={`font-mono font-semibold ${row.high ? "text-red" : "text-ink"}`}>
      {row.pct > 100 ? ">100" : row.pct}%{row.high && <AlertTriangle size={11} className="inline ml-1 -mt-0.5" />}
    </span>
  );
}

function Table({ rows, label, limit }: { rows: ReturnRateRow[]; label: string; limit?: number }) {
  const shown = limit ? rows.slice(0, limit) : rows;
  if (rows.length === 0) return <div className="text-[12px] text-steel">Todavía no hay movimientos.</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-steel text-left">
            <th className="py-1 pr-3 font-semibold">{label}</th>
            <th className="py-1 px-2 font-semibold text-right">Salieron</th>
            <th className="py-1 px-2 font-semibold text-right">Regresaron</th>
            <th className="py-1 pl-2 font-semibold text-right">Devolución</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.key} className="border-t border-rule">
              <td className="py-1.5 pr-3 min-w-[160px]">{r.name}</td>
              <td className="py-1.5 px-2 text-right font-mono">{r.out}</td>
              <td className="py-1.5 px-2 text-right font-mono">{r.returned}</td>
              <td className="py-1.5 pl-2 text-right">
                <Pct row={r} perProduct={label === "Producto"} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {limit && rows.length > limit && <div className="text-[11px] text-steel mt-1">Mostrando los {limit} que más regresan de {rows.length}.</div>}
    </div>
  );
}

// Pedido del usuario 2026-09-30: Tasa de Devolución automática (desde
// octubre 2026) — general, por marca y por producto, sin que nadie anote
// nada. Ver el cálculo en returnRate.ts. Solo lectura.
export async function AutoReturnRatePanel() {
  const [recent, months] = await Promise.all([getRecentReturnRate(), getAutoReturnRateMonths()]);
  const highCount = recent.byProduct.filter((p) => p.high).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="bg-surface border border-teal/35 rounded-md p-4">
        <div className="text-[13px] font-semibold text-ink mb-0.5">Se calcula sola</div>
        <div className="text-[12px] text-steel">
          Compara lo que salió en los cortes con lo que regresó por Reingreso de Mercadería, producto por producto. Como una devolución tarda de 7 a 20 días, lo que regresa se cuenta {RETURN_LAG_DAYS} días corrido. Se cuenta en unidades, por eso puede diferir un poco de ATOM.
        </div>
      </div>

      <div className="bg-surface border border-rule rounded-md p-4">
        <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
          <div className="text-[13px] font-semibold">Últimos 30 días por producto</div>
          {highCount > 0 && (
            <span className="text-[11px] font-semibold text-red">
              <AlertTriangle size={12} className="inline -mt-0.5 mr-1" />
              {highCount} producto{highCount === 1 ? "" : "s"} regresando mucho
            </span>
          )}
        </div>
        <div className="text-[11px] text-steel mb-2">
          <AlertTriangle size={10} className="inline -mt-0.5" /> = regresa {HIGH_RETURN_PCT}% o más, con al menos {HIGH_RETURN_MIN_OUT} unidades salidas.
        </div>
        {recent.readyAt ? (
          <div className="text-[12px] text-steel">
            Empieza a mostrarse el {recent.readyAt.toLocaleDateString("es-EC", { day: "numeric", month: "long", timeZone: "America/Guayaquil" })}: primero tienen que pasar {RETURN_LAG_DAYS} días desde el primer corte para que regresen las devoluciones.
          </div>
        ) : (
          <Table rows={recent.byProduct.filter((p) => p.out > 0)} label="Producto" limit={PRODUCT_LIMIT} />
        )}
      </div>

      {months.map((m) => (
        <details key={m.month} className="bg-surface border border-rule rounded-md p-4" open={m === months[0]}>
          <summary className="cursor-pointer flex items-center gap-3 flex-wrap">
            <span className="font-semibold text-[13.5px]">{formatMonthShort(m.month)}</span>
            <span className="font-mono text-[13px]">{m.pct === null ? "—" : `${m.pct}%`}</span>
            <span className={`text-[10px] font-semibold rounded-full px-2 py-0.5 border ${m.closed ? "text-teal border-teal/40" : "text-gold border-gold/40"}`}>
              {m.closed ? "Cerrado" : `Preliminar · cierra ${RETURN_CLOSE_DAYS} días después de fin de mes`}
            </span>
            <span className="text-[11px] text-steel">
              {m.returned} de {m.out} unidades
            </span>
          </summary>
          <div className="mt-3 flex flex-col gap-4">
            <Table rows={m.byBrand} label="Marca" />
            <Table rows={m.byProduct.filter((p) => p.out > 0)} label="Producto" limit={PRODUCT_LIMIT} />
          </div>
        </details>
      ))}
    </div>
  );
}
