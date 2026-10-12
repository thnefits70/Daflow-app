"use client";

import { Fragment, useEffect, useState } from "react";
import type { ProvedixLeadActivity, ProvedixLeadRow } from "@/lib/provedixTraffic";

// Cartera de dropshippers (etapa 4, 2026-10-12) — SOLO el admin. Por ahora
// nadie los contacta (decisión del usuario), así que el WhatsApp va como
// texto, sin enlace para escribirles.

function when(iso: string) {
  return new Date(iso).toLocaleString("es-EC", { timeZone: "America/Guayaquil", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function dayOnly(iso: string) {
  return new Date(iso).toLocaleDateString("es-EC", { timeZone: "America/Guayaquil", day: "2-digit", month: "2-digit", year: "numeric" });
}

function Activity({ leadId }: { leadId: string }) {
  const [data, setData] = useState<ProvedixLeadActivity | null | "error">(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/provedix/leads/${leadId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: ProvedixLeadActivity) => alive && setData(d))
      .catch(() => alive && setData("error"));
    return () => {
      alive = false;
    };
  }, [leadId]);
  if (data === null) return <div className="text-[12px] text-steel">Cargando historial…</div>;
  if (data === "error") return <div className="text-[12px] text-red">No se pudo cargar el historial. Intenta de nuevo.</div>;
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-[12px]">
      <div>
        <div className="font-semibold mb-1.5">Lo que más buscó</div>
        {data.searches.length === 0 && <div className="text-steel">No ha buscado nada.</div>}
        {data.searches.map((s) => (
          <div key={s.label} className="flex justify-between gap-2">
            <span className="truncate">{s.label}</span>
            <span className="text-steel tabular-nums">{s.count}</span>
          </div>
        ))}
      </div>
      <div>
        <div className="font-semibold mb-1.5">Productos que más abrió</div>
        {data.products.length === 0 && <div className="text-steel">No ha abierto ninguna ficha.</div>}
        {data.products.map((p) => (
          <div key={p.code} className="flex justify-between gap-2" title={`ID ${p.code}`}>
            <span className="truncate">{p.name}</span>
            <span className="text-steel tabular-nums">{p.count}</span>
          </div>
        ))}
      </div>
      <div>
        <div className="font-semibold mb-1.5">Lo último que hizo</div>
        <div className="flex flex-col gap-1 max-h-[220px] overflow-y-auto pr-1">
          {data.recent.map((e, i) => (
            <div key={i} className="flex justify-between gap-2">
              <span className="truncate">{e.text}</span>
              <span className="text-steel tabular-nums shrink-0">{when(e.at)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ProvedixLeadsTable({ leads }: { leads: ProvedixLeadRow[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = q ? leads.filter((l) => l.name.toLowerCase().includes(q) || l.whatsapp.includes(q)) : leads;

  return (
    <div className="bg-surface border border-rule rounded-lg p-5 mb-7">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div>
          <div className="text-[13px] font-semibold">Cartera de dropshippers</div>
          <div className="text-[11px] text-steel">Quienes se registraron en provedix.com. Solo la ves tú. Toca a alguien para ver qué buscó y qué miró.</div>
        </div>
        {leads.length > 0 && (
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar nombre o WhatsApp"
            className="border border-rule rounded-md px-3 py-1.5 text-[12px] bg-surface w-full sm:w-[220px]"
          />
        )}
      </div>
      {leads.length === 0 ? (
        <div className="text-[12px] text-steel">Todavía no se ha registrado nadie.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-[10.5px] uppercase tracking-wide text-steel">
                <th className="pb-2 pr-3 font-semibold">Nombre</th>
                <th className="pb-2 pr-3 font-semibold">WhatsApp</th>
                <th className="pb-2 pr-3 font-semibold">Registro</th>
                <th className="pb-2 pr-3 font-semibold">Última vez</th>
                <th className="pb-2 pr-3 font-semibold text-right">Entradas</th>
                <th className="pb-2 pr-3 font-semibold text-right">Búsquedas</th>
                <th className="pb-2 font-semibold text-right">Productos vistos</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((l) => (
                <Fragment key={l.id}>
                  <tr className={`border-t border-rule cursor-pointer hover:bg-cloud ${open === l.id ? "bg-cloud" : ""}`} onClick={() => setOpen(open === l.id ? null : l.id)}>
                    <td className="py-2 pr-3 font-medium">{l.name}</td>
                    <td className="py-2 pr-3 tabular-nums whitespace-nowrap">{l.whatsapp}</td>
                    <td className="py-2 pr-3 tabular-nums whitespace-nowrap">{dayOnly(l.createdAt)}</td>
                    <td className="py-2 pr-3 tabular-nums whitespace-nowrap">{when(l.lastSeenAt)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{l.visits}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{l.searches}</td>
                    <td className="py-2 text-right tabular-nums">{l.products}</td>
                  </tr>
                  {open === l.id && (
                    <tr className="bg-cloud">
                      <td colSpan={7} className="px-3 pb-4 pt-1">
                        <Activity leadId={l.id} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-3 text-steel">Nadie coincide con esa búsqueda.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
