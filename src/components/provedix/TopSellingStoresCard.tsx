"use client";

import { useEffect, useState } from "react";
import { StoreSalesTable, type StoreSalesRow } from "@/components/provedix/StoreSalesTable";

// Servicio Postventa (Nairoby): a qué tiendas llamar primero. Se pide aparte
// para no hacer más lenta la carga del área de trabajo.
export function TopSellingStoresCard() {
  const [data, setData] = useState<{ windowFrom: string; stores: StoreSalesRow[] } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/provedix/stores")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => alive && setData(d))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, []);

  const from = data?.windowFrom.split("-").reverse().join("/");

  return (
    <div className="bg-surface border border-rule rounded-lg p-5 mb-5">
      <div className="text-[13px] font-semibold mb-1">Tiendas que más venden nuestros productos</div>
      <div className="text-[11px] text-steel mb-3">
        {from ? `Desde el ${from}, solo Provedix e Imp. Damián. ` : ""}Sale de las guías de despacho. Servientrega y Urbano no traen el celular.
      </div>
      {error && <div className="text-[12px] text-steel">No se pudo cargar la lista. Vuelve a intentar en un momento.</div>}
      {!error && !data && <div className="text-[12px] text-steel">Cargando…</div>}
      {data && <StoreSalesTable stores={data.stores} />}
    </div>
  );
}
