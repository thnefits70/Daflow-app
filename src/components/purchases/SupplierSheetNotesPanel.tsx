"use client";

import { useEffect, useRef, useState } from "react";
import { MessageSquareText, Sparkles } from "lucide-react";
import { formatDateTime } from "@/lib/formatDateTime";

type Note = {
  id: string;
  text: string;
  authorEmail: string;
  tabName: string;
  createdAt: string;
  updatedAt: string;
  clearedAt: string | null;
  forMe: boolean;
  notifiedToNames: string[];
  routeMethod: string | null;
  routeReason: string | null;
  isPayment: boolean;
  order: {
    code: string | null;
    productName: string;
    photoUrl: string | null;
    quantity: number;
    requestedAt: string;
    statusText: string;
    statusTone: "green" | "amber" | "gray";
    paymentText: string;
  } | null;
};

const TONE: Record<"green" | "amber" | "gray", string> = {
  green: "bg-green/10 text-green",
  amber: "bg-gold/15 text-gold",
  gray: "bg-cloud text-steel",
};

// Confirmado 2026-09-24, pedido explícito del usuario: lo que la gente de
// CHEN anota en su hoja, dentro de DAFLOW — cada nota con el pedido al que
// está pegada (producto, cantidad, código y estado actual), para gestionarlo
// desde acá sin buscar a qué pedido se refiere. El aviso le llega solo a
// quien corresponde (ver supplierSheetNotes.ts); acá también se ve a quién
// se avisó y por qué.
export function SupplierSheetNotesPanel() {
  const [all, setAll] = useState(false);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [focusId] = useState<string | null>(() => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("nota")));
  const focusRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/supplier-sheet-notes${all ? "?all=1" : ""}`)
      .then((r) => (r.ok ? r.json() : { notes: [] }))
      .then((d: { notes: Note[] }) => {
        if (alive) setNotes(d.notes);
      })
      .catch(() => {
        if (alive) setNotes([]);
      });
    return () => {
      alive = false;
    };
  }, [all]);

  useEffect(() => {
    if (notes && focusId) focusRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [notes, focusId]);

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-[12.5px]">
        <button
          type="button"
          className={`rounded border px-2.5 py-1 cursor-pointer ${!all ? "border-teal bg-teal/10 font-semibold text-ink" : "border-rule text-steel"}`}
          onClick={() => setAll(false)}
        >
          Para mí
        </button>
        <button
          type="button"
          className={`rounded border px-2.5 py-1 cursor-pointer ${all ? "border-teal bg-teal/10 font-semibold text-ink" : "border-rule text-steel"}`}
          onClick={() => setAll(true)}
        >
          Todas
        </button>
      </div>

      {notes === null ? (
        <div className="text-steel text-[13px]">Cargando…</div>
      ) : notes.length === 0 ? (
        <div className="text-steel text-[13px]">{all ? "Todavía nadie de Chen escribió notas en la hoja." : "No tienes notas de Chen por ahora."}</div>
      ) : (
        <div className="flex flex-col gap-2">
          {notes.map((n) => {
            const focused = n.id === focusId;
            return (
              <div
                key={n.id}
                ref={focused ? focusRef : undefined}
                className={`rounded-md border bg-surface px-3.5 py-3 text-[13px] ${focused ? "border-teal ring-2 ring-teal/30" : "border-rule"} ${n.clearedAt ? "opacity-60" : ""}`}
              >
                <div className="flex flex-wrap items-start gap-3">
                  {n.order?.photoUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={n.order.photoUrl} alt="" className="h-14 w-14 shrink-0 rounded border border-rule object-cover" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 text-[11.5px] text-steel">
                      {n.order ? (
                        <>
                          <span className="font-semibold text-ink">{n.order.productName}</span> · {n.order.quantity} un.
                          {n.order.code && <> · {n.order.code}</>} · pedido {formatDateTime(n.order.requestedAt)}
                        </>
                      ) : n.isPayment ? (
                        <>Nota en un pago · hoja &quot;{n.tabName}&quot;</>
                      ) : (
                        <>Nota general · hoja &quot;{n.tabName}&quot;</>
                      )}
                    </div>
                    <div className="flex items-start gap-1.5 text-ink">
                      <MessageSquareText size={14} className="mt-0.5 shrink-0 text-teal" />
                      <span className={`whitespace-pre-wrap break-words ${n.clearedAt ? "line-through" : ""}`}>{n.text}</span>
                    </div>
                    <div className="mt-1 text-[11.5px] text-steel">
                      {n.authorEmail} · {formatDateTime(n.updatedAt)}
                      {n.clearedAt && <> · Chen la borró el {formatDateTime(n.clearedAt)}</>}
                    </div>
                    {n.order && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11.5px]">
                        <span className={`rounded px-1.5 py-0.5 ${TONE[n.order.statusTone]}`}>{n.order.statusText}</span>
                        <span className="rounded bg-cloud px-1.5 py-0.5 text-steel">{n.order.paymentText}</span>
                      </div>
                    )}
                    <div className="mt-1.5 flex items-center gap-1 text-[11px] text-steel">
                      {n.routeMethod === "ia" && <Sparkles size={11} className="text-teal" />}
                      Avisado a: {n.notifiedToNames.length ? n.notifiedToNames.join(", ") : "nadie"}
                      {n.routeReason && <> — {n.routeMethod === "ia" ? "decidió la IA" : n.routeMethod === "respaldo" ? "respaldo" : "por la etapa"}: {n.routeReason}</>}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
