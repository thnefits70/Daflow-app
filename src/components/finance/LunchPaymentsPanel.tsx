"use client";

import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { TabGuide } from "@/components/shared/TabGuide";
import { AdminPayeePicker, type AdminPaymentPayeeDTO } from "@/components/finance/AdminPayeePicker";
import { formatDateTime } from "@/lib/formatDateTime";

type PaymentStatus = "PENDING_PAYMENT" | "PAID" | "CONFIRMED";

type HistoryRow = {
  id: string;
  weekStart: string;
  weekEnd: string;
  lunchCount: number;
  monto: number;
  registeredAt: string;
  invoiceConfirmedAt: string | null;
  sentToVerificationAt: string | null;
  verifiedAt: string | null;
  adminPaymentRequest: { status: PaymentStatus } | null;
};

const STATUS_LABELS: Record<PaymentStatus, string> = {
  PENDING_PAYMENT: "Pendiente de pago",
  PAID: "Pagado — falta confirmar",
  CONFIRMED: "Confirmado",
};

function money(n: number) {
  return `$${n.toLocaleString("es-MX", { minimumFractionDigits: 2 })}`;
}
function dateEs(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("es-EC", { day: "numeric", month: "long", year: "numeric" });
}

// Mismo picker nativo "Semana" que ya usa Marcar producto sin stock
// (StockoutPanel) — un solo toque abre el calendario del navegador y elige
// la semana, sin escribir fechas a mano. El convenio con el restaurante es
// de lunes a sábado (mismo patrón que businessHours.ts), así que la semana
// ISO elegida (que abarca lunes-domingo) se recorta a esos 6 días.
function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Semana ISO-8601 ("YYYY-Www") -> lunes de esa semana, en "YYYY-MM-DD".
function isoWeekMonday(week: string): string | null {
  const match = /^(\d{4})-W(\d{1,2})$/.exec(week);
  if (!match) return null;
  const year = Number(match[1]);
  const weekNum = Number(match[2]);
  const simple = new Date(Date.UTC(year, 0, 1 + (weekNum - 1) * 7));
  const dayOfWeek = simple.getUTCDay() || 7;
  simple.setUTCDate(simple.getUTCDate() + (dayOfWeek <= 4 ? 1 - dayOfWeek : 8 - dayOfWeek));
  return simple.toISOString().slice(0, 10);
}

// Fecha -> semana ISO-8601 que la contiene (inverso de isoWeekMonday), para
// sugerir de entrada la semana pendiente que sigue a la última registrada.
function dateToIsoWeek(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day); // jueves de esa semana
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

// El convenio corre lunes a sábado — si la fecha sugerida (día siguiente a la
// última semana registrada) cae domingo, esa semana ISO ya es la misma que
// se acaba de registrar. Hay que saltar al lunes siguiente para sugerir la
// semana correcta.
function nextMondayOnOrAfter(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDay(); // 0=domingo … 6=sábado
  const forward = (1 - day + 7) % 7;
  d.setUTCDate(d.getUTCDate() + forward);
  return d.toISOString().slice(0, 10);
}

// Confirmado 2026-09-08: pedido explícito del usuario — el admin no debe ver
// nada de esto hasta que Nairoby verifique, así que acá se muestra el paso en
// el que está cada semana en vez de un único estado de pago.
function stageLabel(h: HistoryRow): string {
  if (h.adminPaymentRequest) return STATUS_LABELS[h.adminPaymentRequest.status];
  if (h.sentToVerificationAt) return "Enviado a Nairoby — pendiente de verificar";
  if (h.invoiceConfirmedAt) return "Factura confirmada — falta enviar a Nairoby";
  return "Registrado — falta confirmar factura";
}

export function LunchPaymentsPanel() {
  const [loaded, setLoaded] = useState(false);
  const [pricePerLunch, setPricePerLunch] = useState(2.5);
  const [payees, setPayees] = useState<AdminPaymentPayeeDTO[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);

  const [weekInput, setWeekInput] = useState(""); // "YYYY-Www", del picker nativo
  const [lunchCount, setLunchCount] = useState("");
  const [montoOverride, setMontoOverride] = useState<string | null>(null);
  const [payee, setPayee] = useState<AdminPaymentPayeeDTO | null>(null);
  const [bankAccountId, setBankAccountId] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actingOnId, setActingOnId] = useState<string | null>(null);
  const [err, setErr] = useState("");

  function load() {
    fetch("/api/lunch-payments")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        setPricePerLunch(data.settings.pricePerLunch);
        setPayees(data.payees ?? []);
        setHistory(data.history ?? []);
        const rawStart = data.defaults.suggestedWeekStart ?? new Date().toISOString().slice(0, 10);
        setWeekInput(dateToIsoWeek(nextMondayOnOrAfter(rawStart)));
        if (data.defaults.payeeId) {
          const p = (data.payees ?? []).find((x: AdminPaymentPayeeDTO) => x.id === data.defaults.payeeId);
          if (p) setPayee(p);
        }
        if (data.defaults.bankAccountId) setBankAccountId(data.defaults.bankAccountId);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }
  useEffect(load, []);

  const weekMonday = isoWeekMonday(weekInput);
  const weekStart = weekMonday ?? "";
  const weekEnd = weekMonday ? addDaysIso(weekMonday, 5) : "";

  const computedMonto = Number(lunchCount) > 0 ? (Number(lunchCount) * pricePerLunch).toFixed(2) : "";
  const monto = montoOverride ?? computedMonto;

  async function submit() {
    setErr("");
    if (!weekStart || !weekEnd) {
      setErr("Elige la semana.");
      return;
    }
    const count = Number(lunchCount);
    if (!count || count <= 0) {
      setErr("Ingresa la cantidad de almuerzos de esta semana.");
      return;
    }
    setSubmitting(true);
    const res = await fetch("/api/lunch-payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        weekStart,
        weekEnd,
        lunchCount: count,
        monto: monto ? Number(monto) : undefined,
        payeeId: payee?.id ?? undefined,
        bankAccountId: bankAccountId ?? undefined,
      }),
    });
    setSubmitting(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(data?.error ?? "No se pudo registrar.");
      return;
    }
    setLunchCount("");
    setMontoOverride(null);
    load();
  }

  async function confirmInvoice(id: string) {
    setErr("");
    setActingOnId(id);
    const res = await fetch(`/api/lunch-payments/${id}/confirm-invoice`, { method: "POST" });
    setActingOnId(null);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(data?.error ?? "No se pudo confirmar.");
      return;
    }
    load();
  }

  async function sendToVerification(id: string) {
    setErr("");
    setActingOnId(id);
    const res = await fetch(`/api/lunch-payments/${id}/send`, { method: "POST" });
    setActingOnId(null);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(data?.error ?? "No se pudo enviar.");
      return;
    }
    load();
  }

  if (!loaded) return null;

  return (
    <div>
      <TabGuide storageKey="almuerzos-semanales">
        Registra acá, cada semana, cuántos almuerzos se pidieron (convenio con el restaurante) — el monto se calcula
        solo. Después confirma que la proveedora te avisó que envió la factura y envíalo a Nairoby: ella lo revisa y
        recién ahí llega al admin para que pague.
      </TabGuide>

      <div className="bg-surface border border-rule rounded-md p-4 mb-4">
        <div className="text-[13px] font-bold mb-2.5">Registrar semana de almuerzos</div>
        <div className="text-[11px] text-steel mb-2.5">Precio actual: {money(pricePerLunch)} por almuerzo (IVA incluido)</div>

        <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Semana</label>
        <input
          type="week"
          value={weekInput}
          onChange={(e) => setWeekInput(e.target.value)}
          className="rounded border border-rule px-2.5 py-2 text-[13px] bg-surface mb-1"
        />
        {weekStart && weekEnd && <div className="text-[11px] text-steel mb-2.5">{dateEs(weekStart)} al {dateEs(weekEnd)}</div>}

        <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Cantidad de almuerzos</label>
        <input
          type="number"
          min="1"
          value={lunchCount}
          onChange={(e) => setLunchCount(e.target.value)}
          placeholder="Ej. 45"
          className="w-full rounded border border-rule px-2.5 py-2 text-[13px] mb-2.5"
        />

        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="text-[11px] text-teal cursor-pointer mb-2.5"
        >
          {showAdvanced ? "Ocultar" : "Ajustar monto o a quién pagar"}
        </button>

        {showAdvanced && (
          <>
            <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">
              Monto a pagar <span className="text-steel-dim">(se calcula solo — ajusta si la factura real difiere por centavos)</span>
            </label>
            <input
              type="number"
              step="0.01"
              value={monto}
              onChange={(e) => setMontoOverride(e.target.value)}
              className="w-full rounded border border-rule px-2.5 py-2 text-[13px] mb-2.5"
            />

            <div className="mb-2.5">
              <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">A quién pagar <span className="text-steel-dim">(opcional)</span></label>
              <AdminPayeePicker
                payees={payees}
                value={payee}
                onChange={setPayee}
                isAdmin={false}
                selectedBankAccountId={bankAccountId}
                onSelectBankAccount={setBankAccountId}
                onPayeeUpdated={(p) => setPayees((cur) => (cur.some((x) => x.id === p.id) ? cur.map((x) => (x.id === p.id ? p : x)) : [...cur, p].sort((a, b) => a.name.localeCompare(b.name))))}
              />
            </div>
          </>
        )}

        {err && <div className="text-red text-[12px] mb-2.5">{err}</div>}

        <button
          type="button"
          disabled={submitting}
          className="rounded border border-blue bg-blue px-3.5 py-1.5 text-[12.5px] font-semibold text-white cursor-pointer disabled:opacity-60"
          onClick={submit}
        >
          {submitting ? "Enviando…" : "Registrar semana"}
        </button>
      </div>

      <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-2">Semanas ya registradas</div>
      {history.length === 0 ? (
        <div className="text-[12.5px] text-steel">Todavía no has registrado ninguna semana.</div>
      ) : (
        <div className="flex flex-col gap-2">
          {history.map((h) => (
            <div key={h.id} className="bg-surface border border-rule rounded-md px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12.5px] font-semibold">
                  {dateEs(h.weekStart.slice(0, 10))} al {dateEs(h.weekEnd.slice(0, 10))}
                </span>
                <span className="text-[12.5px] font-semibold shrink-0">{money(h.monto)}</span>
              </div>
              <div className="flex items-center justify-between gap-2 mt-1">
                <span className="text-[11px] text-steel">{h.lunchCount} almuerzos · registrado {formatDateTime(h.registeredAt)}</span>
                <span className="text-[11px] text-steel shrink-0">{stageLabel(h)}</span>
              </div>

              {!h.invoiceConfirmedAt && (
                <button
                  type="button"
                  disabled={actingOnId === h.id}
                  className="mt-2 rounded border border-teal px-2.5 py-1 text-[11.5px] font-semibold text-teal cursor-pointer disabled:opacity-50"
                  onClick={() => confirmInvoice(h.id)}
                >
                  Confirmar que la proveedora envió la factura
                </button>
              )}

              {h.invoiceConfirmedAt && !h.sentToVerificationAt && (
                <div className="mt-2 flex items-center gap-2">
                  <div className="flex items-center gap-1.5 text-[11.5px] text-teal">
                    <CheckCircle2 size={13} /> Factura confirmada
                  </div>
                  <button
                    type="button"
                    disabled={actingOnId === h.id}
                    className="rounded border border-blue bg-blue px-2.5 py-1 text-[11.5px] font-semibold text-white cursor-pointer disabled:opacity-50"
                    onClick={() => sendToVerification(h.id)}
                  >
                    Enviar a Nairoby
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
