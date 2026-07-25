"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, ChevronDown, ChevronUp, PhoneCall, Search } from "lucide-react";
import { Combobox } from "@/components/ui/Combobox";
import { retentionRiskFor } from "@/lib/storeFeedbackCalc";

type EvaluationDTO = {
  id: string;
  period: string;
  loyaltyScore: number;
  fulfillmentScore: number;
  qualityScore: number;
  responseTimeScore: number;
  commercialTermsScore: number;
  communicationScore: number;
  comment: string;
  actionPlan: string;
  growthNeeds: string;
  evaluatedByName: string | null;
  evaluatedAt: string;
};

type StoreDTO = {
  id: string;
  name: string;
  contactName: string | null;
  contactPhone: string | null;
  brand: string | null;
  isActive: boolean;
  evaluations: EvaluationDTO[];
};

const MONTH_ABBR = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
function monthLabel(period: string) {
  const [y, m] = period.split("-");
  return `${MONTH_ABBR[Number(m) - 1]} ${y}`;
}

function prevMonthStr(): string {
  const d = new Date();
  const prev = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  return `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Solo 3 marcas conocidas, confirmado 2026-07-25 — la tercera todavía en
// espera, igual que en el catálogo de operaciones de Finanzas.
const BRANDS = ["Provedix", "Importadora Damián", "Importadora Shanghai"] as const;
const BRAND_INACTIVE = "Importadora Shanghai";

// Lista corta de países relevantes para tiendas que venden fuera de Ecuador
// — confirmado 2026-07-25. Si se pega un número que ya empieza con "+", se
// usa tal cual (no se antepone el código de nuevo).
const COUNTRY_CODES = [
  { flag: "🇪🇨", dial: "+593", name: "Ecuador" },
  { flag: "🇨🇴", dial: "+57", name: "Colombia" },
  { flag: "🇵🇪", dial: "+51", name: "Perú" },
  { flag: "🇲🇽", dial: "+52", name: "México" },
  { flag: "🇵🇦", dial: "+507", name: "Panamá" },
  { flag: "🇨🇱", dial: "+56", name: "Chile" },
  { flag: "🇦🇷", dial: "+54", name: "Argentina" },
  { flag: "🇻🇪", dial: "+58", name: "Venezuela" },
  { flag: "🇧🇴", dial: "+591", name: "Bolivia" },
  { flag: "🇵🇾", dial: "+595", name: "Paraguay" },
  { flag: "🇺🇾", dial: "+598", name: "Uruguay" },
  { flag: "🇨🇷", dial: "+506", name: "Costa Rica" },
  { flag: "🇬🇹", dial: "+502", name: "Guatemala" },
  { flag: "🇭🇳", dial: "+504", name: "Honduras" },
  { flag: "🇸🇻", dial: "+503", name: "El Salvador" },
  { flag: "🇳🇮", dial: "+505", name: "Nicaragua" },
  { flag: "🇩🇴", dial: "+1", name: "Rep. Dominicana" },
  { flag: "🇧🇷", dial: "+55", name: "Brasil" },
  { flag: "🇺🇸", dial: "+1", name: "Estados Unidos" },
  { flag: "🇪🇸", dial: "+34", name: "España" },
] as const;

function buildPhone(dial: string, numberRaw: string): string {
  const trimmed = numberRaw.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("+") ? trimmed : `${dial} ${trimmed}`;
}

function waLink(phone: string): string {
  return `https://wa.me/${phone.replace(/\D/g, "")}`;
}

function WhatsAppIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21h.01c5.46 0 9.9-4.45 9.9-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2m0 1.8c2.19 0 4.24.85 5.78 2.4a8.13 8.13 0 0 1 2.4 5.72c0 4.48-3.65 8.12-8.13 8.12a8.1 8.1 0 0 1-4.14-1.13l-.3-.17-3.1.81.83-3.02-.19-.31a8.08 8.08 0 0 1-1.24-4.32c0-4.48 3.65-8.1 8.14-8.1" />
    </svg>
  );
}

function RateGroup({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="inline-flex border border-rule rounded overflow-hidden">
      {[1, 2, 3, 4, 5].map((n, i) => (
        <button
          key={n}
          type="button"
          className={`w-8.5 h-8.5 text-[13px] font-bold font-mono cursor-pointer ${
            i < 4 ? "border-r border-rule" : ""
          } ${Number(value) === n ? "bg-teal text-navy" : "bg-surface text-steel"}`}
          onClick={() => onChange(String(n))}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

const DRIVER_FIELDS = [
  {
    key: "fulfillmentScore",
    label: "Cumplimiento de pedidos",
    question: "¿Te hemos estado despachando a tiempo y completo?",
  },
  {
    key: "qualityScore",
    label: "Gestión de garantías",
    question: "¿Qué tan bien te hemos atendido cuando has tenido una garantía, tomando en cuenta el tiempo, el proceso y el cumplimiento?",
  },
  {
    key: "responseTimeScore",
    label: "Tiempo de respuesta ante problemas",
    question: "Cuando ha habido un problema, ¿qué tan rápido te lo resolvimos?",
  },
  {
    key: "commercialTermsScore",
    label: "Condiciones comerciales",
    question: "¿Cómo te sientes con los precios de nuestros productos?",
  },
  {
    key: "communicationScore",
    label: "Atención y comunicación",
    question: "¿Cómo ha sido la atención de tu asesor o asesora?",
  },
] as const;

// Guion de referencia para las llamadas — mismos 5 pilares que el formulario
// de abajo, en el mismo orden, para que la llamada y el registro coincidan
// paso a paso. Pensado para durar menos de 5 minutos.
const CALL_SCRIPT_STEPS = [
  {
    time: "~30 seg",
    title: "Apertura",
    body: "“Hola [nombre], soy Nairoby de Provedix. Te llamo rapidito, menos de 5 minutos, para hacerte unas preguntas sobre cómo nos ha ido este mes — nos sirve para mejorar el servicio que te damos y también para que ustedes sigan creciendo con nosotros como socios de negocio.” Si notaste que pidieron más mercadería que de costumbre este mes, coméntaselo — es una buena entrada para explicar que la llamada busca fortalecer la relación comercial, darles mejor servicio, más oportunidades para seguir creciendo y, más adelante, algún acuerdo especial.",
  },
  {
    time: "~30 seg",
    title: "Fidelización (pregunta general)",
    body: "“En una escala del 1 al 5, ¿qué tan probable es que sigas comprándonos en los próximos meses?” — esto es la Fidelización del formulario.",
  },
  {
    time: "~1.5 min",
    title: "Los 5 pilares (rapid-fire, ~20 seg cada uno)",
    body: "Pide una nota de 1 a 5 en cada uno, en este orden:",
  },
  {
    time: "~1 min",
    title: "Cierre asertivo (2 preguntas abiertas)",
    body: "“¿Qué es lo único que más te gustaría que mejoráramos este mes?” (esto va en Plan de acción) y “¿Qué necesitas de nosotros para seguir creciendo tus ventas?” (esto va en Necesidades de crecimiento).",
  },
  {
    time: "~10 seg",
    title: "Agradecimiento",
    body: "“Gracias por tu tiempo, [nombre]. Vamos a trabajar en eso y te cuento en la próxima llamada.”",
  },
] as const;

export function StoreFeedbackPanel({ stores, editable = true }: { stores: StoreDTO[]; editable?: boolean }) {
  const router = useRouter();
  const [storeName, setStoreName] = useState("");
  const [contactName, setContactName] = useState("");
  const [brand, setBrand] = useState<string>(BRANDS[0]);
  const [countryDial, setCountryDial] = useState<string>(COUNTRY_CODES[0].dial);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [period, setPeriod] = useState(prevMonthStr());
  const [loyaltyScore, setLoyaltyScore] = useState("4");
  const [scores, setScores] = useState<Record<(typeof DRIVER_FIELDS)[number]["key"], string>>({
    fulfillmentScore: "4",
    qualityScore: "4",
    responseTimeScore: "4",
    commercialTermsScore: "4",
    communicationScore: "4",
  });
  const [comment, setComment] = useState("");
  const [actionPlan, setActionPlan] = useState("");
  const [growthNeeds, setGrowthNeeds] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [expandedStoreId, setExpandedStoreId] = useState<string | null>(null);
  const [showScript, setShowScript] = useState(false);

  const [search, setSearch] = useState("");
  const [brandFilter, setBrandFilter] = useState("");
  const [monthFrom, setMonthFrom] = useState("");
  const [monthTo, setMonthTo] = useState("");

  const activeStores = stores.filter((s) => s.isActive);

  const query = search.trim().toLowerCase();
  const filteredStores = stores.filter((s) => {
    if (query) {
      const hay = `${s.name} ${s.contactName ?? ""} ${s.contactPhone ?? ""}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    if (brandFilter && s.brand !== brandFilter) return false;
    if (monthFrom || monthTo) {
      const inRange = s.evaluations.some(
        (e) => (!monthFrom || e.period >= monthFrom) && (!monthTo || e.period <= monthTo)
      );
      if (!inRange) return false;
    }
    return true;
  });

  const submit = async () => {
    const name = storeName.trim();
    if (!name) return setErr("Escribe o elige el nombre de la tienda.");
    const loyalty = Number(loyaltyScore);
    if (Number.isNaN(loyalty) || loyalty < 1 || loyalty > 5) return setErr("La fidelización debe ser un número entre 1 y 5.");
    for (const f of DRIVER_FIELDS) {
      const v = Number(scores[f.key]);
      if (Number.isNaN(v) || v < 1 || v > 5) return setErr(`${f.label} debe estar entre 1 y 5.`);
    }
    if (!actionPlan.trim()) return setErr("El plan de acción es obligatorio — resume qué se acordó en la llamada.");
    if (!growthNeeds.trim()) return setErr("Las necesidades de crecimiento son obligatorias — resume qué pidió la tienda.");
    setErr("");
    setBusy(true);

    let storeId = stores.find((s) => s.name.toLowerCase() === name.toLowerCase())?.id;
    if (!storeId) {
      const res = await fetch("/api/stores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          contactName: contactName.trim() || undefined,
          contactPhone: buildPhone(countryDial, phoneNumber) || undefined,
          brand,
        }),
      });
      if (!res.ok) {
        setBusy(false);
        const data = await res.json().catch(() => null);
        return setErr(data?.error ?? "No se pudo crear la tienda.");
      }
      storeId = (await res.json()).id;
    }

    const res = await fetch(`/api/stores/${storeId}/evaluations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        period,
        loyaltyScore: loyalty,
        ...Object.fromEntries(DRIVER_FIELDS.map((f) => [f.key, Number(scores[f.key])])),
        comment: comment.trim() || undefined,
        actionPlan: actionPlan.trim(),
        growthNeeds: growthNeeds.trim(),
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      return setErr(data?.error ?? "No se pudo guardar la evaluación.");
    }
    setStoreName("");
    setContactName("");
    setPhoneNumber("");
    setComment("");
    setActionPlan("");
    setGrowthNeeds("");
    router.refresh();
  };

  const deleteEvaluation = async (storeId: string, evalId: string) => {
    setBusy(true);
    await fetch(`/api/stores/${storeId}/evaluations/${evalId}`, { method: "DELETE" });
    setBusy(false);
    router.refresh();
  };

  const toggleActive = async (id: string, isActive: boolean) => {
    setBusy(true);
    await fetch(`/api/stores/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !isActive }),
    });
    setBusy(false);
    router.refresh();
  };

  const deleteStore = async (id: string) => {
    setBusy(true);
    const res = await fetch(`/api/stores/${id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setErr(data?.error ?? "No se pudo eliminar.");
      return;
    }
    router.refresh();
  };

  return (
    <div>
      <div className="text-[13px] text-steel mb-2 max-w-2xl">
        {editable
          ? 'Registra el feedback de cada llamada a una tienda: fidelización ("¿qué tan probable es que sigas comprándonos?") y los KPIs que explican ese resultado — todos del 1 al 5, donde 5 es excelente y 1 es malo. El promedio de todas las tiendas evaluadas cada mes es lo que se muestra públicamente en Inicio.'
          : "Consulta de solo lectura: el detalle de cada llamada a una tienda, quién la evaluó y qué se acordó. Puedes contactar directo por WhatsApp, pero no puedes crear, editar ni eliminar evaluaciones."}
      </div>

      {editable && (
        <>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-blue cursor-pointer mb-4"
            onClick={() => setShowScript((v) => !v)}
          >
            <PhoneCall size={13} /> {showScript ? "Ocultar guion de llamada" : "Ver guion de llamada (< 5 min)"}
          </button>

          {showScript && (
            <div className="bg-surface border border-rule rounded p-4 mb-5 max-w-2xl">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-3">
                Guion sugerido para la llamada
              </div>
              <div className="space-y-3">
                {CALL_SCRIPT_STEPS.map((step) => (
                  <div key={step.title} className="flex gap-3">
                    <div className="font-mono text-[10.5px] text-teal font-semibold shrink-0 w-14 pt-0.5">{step.time}</div>
                    <div>
                      <div className="text-[12.5px] font-semibold text-ink mb-0.5">{step.title}</div>
                      <div className="text-[12px] text-steel leading-snug">{step.body}</div>
                      {step.title.startsWith("Los 5 pilares") && (
                        <ol className="mt-1.5 space-y-1 list-decimal list-inside">
                          {DRIVER_FIELDS.map((f) => (
                            <li key={f.key} className="text-[12px] text-ink/90">
                              <span className="font-semibold">{f.label}:</span> &ldquo;{f.question}&rdquo;
                            </li>
                          ))}
                        </ol>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-surface border border-rule rounded p-4 mb-5">
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">Tienda</label>
                <Combobox
                  value={storeName}
                  onChange={setStoreName}
                  options={activeStores.map((s) => ({ id: s.id, name: s.name }))}
                  placeholder="Escribe el nombre — si no existe, se crea"
                  className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px]"
                />
              </div>
              <div>
                <label className="block mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">
                  Dueño o administrador
                </label>
                <input
                  className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px]"
                  placeholder="Nombre de quien atiende"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">
                  Bodega / marca
                </label>
                <select
                  className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px] bg-white"
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                >
                  {BRANDS.map((b) => (
                    <option key={b} value={b} disabled={b === BRAND_INACTIVE}>
                      {b === BRAND_INACTIVE ? `${b} (en espera)` : b}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">
                  Mes evaluado
                </label>
                <input
                  type="month"
                  className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px]"
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                />
              </div>
            </div>

            <div className="mb-3">
              <label className="block mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">
                Teléfono de contacto (WhatsApp)
              </label>
              <div className="flex items-center gap-2">
                <select
                  className="rounded border border-rule px-2 py-2 text-[13px] font-semibold bg-white shrink-0"
                  value={countryDial}
                  onChange={(e) => setCountryDial(e.target.value)}
                >
                  {COUNTRY_CODES.map((c) => (
                    <option key={c.name} value={c.dial}>
                      {c.flag} {c.dial} {c.name}
                    </option>
                  ))}
                </select>
                <input
                  className="flex-1 rounded border border-rule px-2.5 py-2 text-[13.5px]"
                  placeholder="99 123 4567 — o pega el número completo con +"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                />
              </div>
              <div className="text-[10.5px] text-steel mt-1">
                Escoge el país y escribe solo el número, o pega el número completo con &ldquo;+&rdquo; y código incluido.
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">
                  Fidelización — ¿seguirá comprándonos?
                </label>
                <RateGroup value={loyaltyScore} onChange={setLoyaltyScore} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-3">
              {DRIVER_FIELDS.map((f) => (
                <div key={f.key}>
                  <label className="block mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">
                    {f.label}
                  </label>
                  <RateGroup value={scores[f.key]} onChange={(v) => setScores((s) => ({ ...s, [f.key]: v }))} />
                </div>
              ))}
            </div>

            <textarea
              className="w-full rounded border border-rule px-2.5 py-2 text-[13px] mb-3"
              rows={2}
              placeholder="Comentario (opcional) — qué dijo la tienda, qué prometimos mejorar..."
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />

            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">
                  Plan de acción
                </label>
                <textarea
                  className="w-full rounded border border-rule px-2.5 py-2 text-[13px]"
                  rows={2}
                  placeholder="Resume qué se acordó en la llamada: ¿qué vamos a hacer este mes para fortalecer la relación?"
                  value={actionPlan}
                  onChange={(e) => setActionPlan(e.target.value)}
                />
              </div>
              <div>
                <label className="block mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">
                  Necesidades de crecimiento
                </label>
                <textarea
                  className="w-full rounded border border-rule px-2.5 py-2 text-[13px]"
                  rows={2}
                  placeholder="Resume qué pidió la tienda: ¿qué necesita de nosotros para crecer? (stock, apoyo creativo, tiempos...)"
                  value={growthNeeds}
                  onChange={(e) => setGrowthNeeds(e.target.value)}
                />
              </div>
            </div>
            <div className="text-[11px] text-steel mb-3 -mt-1.5">
              Resume la llamada en estos dos campos — es lo que verán quienes gestionan la atención al cliente para
              ejecutar el plan y fortalecer la relación con la tienda.
            </div>

            <button
              type="button"
              disabled={busy}
              className="rounded border border-blue bg-blue px-4 py-2 text-[13px] font-semibold text-white cursor-pointer disabled:opacity-60"
              onClick={submit}
            >
              <Plus size={14} className="inline mr-1" /> Guardar evaluación
            </button>
            {err && <div className="text-red text-[12.5px] mt-2">{err}</div>}
          </div>
        </>
      )}

      {stores.length === 0 ? (
        <div className="border-[1.5px] border-dashed border-rule rounded-md p-8.5 text-center text-steel text-[13.5px]">
          Aún no hay tiendas evaluadas.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3 mb-3.5">
            <div className="flex-1 min-w-[220px]">
              <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">
                Buscar (tienda, dueño, administrador o teléfono)
              </label>
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-steel" />
                <input
                  type="text"
                  className="w-full rounded border border-rule pl-8 pr-2.5 py-2 text-[13px]"
                  placeholder="Escribe cualquier dato…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Bodega</label>
              <select
                className="rounded border border-rule px-2.5 py-2 text-[13px] bg-white"
                value={brandFilter}
                onChange={(e) => setBrandFilter(e.target.value)}
              >
                <option value="">Todas</option>
                {BRANDS.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Desde</label>
              <input
                type="month"
                className="rounded border border-rule px-2.5 py-2 text-[13px]"
                value={monthFrom}
                onChange={(e) => setMonthFrom(e.target.value)}
              />
            </div>
            <div>
              <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Hasta</label>
              <input
                type="month"
                className="rounded border border-rule px-2.5 py-2 text-[13px]"
                value={monthTo}
                onChange={(e) => setMonthTo(e.target.value)}
              />
            </div>
          </div>

          {filteredStores.length === 0 ? (
            <div className="text-steel text-[13px] mb-2">Sin resultados.</div>
          ) : (
            <div className="max-h-[420px] overflow-y-auto pr-1.5 space-y-2.5">
              {filteredStores.map((s) => {
                const isOpen = expandedStoreId === s.id;
                const latest = s.evaluations[0];
                return (
                  <div key={s.id} className="bg-surface border border-rule rounded p-4">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <button
                        type="button"
                        className="flex items-center gap-2 cursor-pointer text-left"
                        onClick={() => setExpandedStoreId(isOpen ? null : s.id)}
                      >
                        {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        <div>
                          <div className={`font-semibold text-[14px] flex items-center gap-1.5 ${!s.isActive ? "opacity-60" : ""}`}>
                            {s.name}
                            {s.brand && (
                              <span className="font-mono text-[9.5px] font-semibold border border-rule rounded-full px-1.5 py-0.5 text-steel">
                                {s.brand}
                              </span>
                            )}
                          </div>
                          <div className="text-[11.5px] text-steel">
                            {s.contactName && `${s.contactName} · `}
                            {s.evaluations.length} evaluación{s.evaluations.length === 1 ? "" : "es"}
                            {latest && ` · última: ${monthLabel(latest.period)} · fidelización ${latest.loyaltyScore}/5`}
                            {s.contactPhone && ` · ${s.contactPhone}`}
                          </div>
                        </div>
                      </button>
                      <div className="flex items-center gap-2">
                        {latest && (
                          <span
                            className="font-mono text-[10.5px] font-semibold tracking-wide px-2 py-1 rounded-full whitespace-nowrap"
                            style={{ color: retentionRiskFor(latest.loyaltyScore).color, border: `1px solid ${retentionRiskFor(latest.loyaltyScore).color}`, background: `${retentionRiskFor(latest.loyaltyScore).color}1a` }}
                          >
                            {retentionRiskFor(latest.loyaltyScore).icon} {retentionRiskFor(latest.loyaltyScore).label}
                          </span>
                        )}
                        {s.contactPhone && (
                          <a
                            href={waLink(s.contactPhone)}
                            target="_blank"
                            rel="noreferrer"
                            title="Contactar por WhatsApp"
                            className="inline-flex items-center justify-center w-7.5 h-7.5 rounded bg-[#1f9e57] text-white cursor-pointer"
                          >
                            <WhatsAppIcon size={14} />
                          </a>
                        )}
                        {editable && (
                          <>
                            <button
                              type="button"
                              disabled={busy}
                              className="text-[12px] text-steel border border-rule rounded px-2.5 py-1.5 cursor-pointer disabled:opacity-60"
                              onClick={() => toggleActive(s.id, s.isActive)}
                            >
                              {s.isActive ? "Desactivar" : "Activar"}
                            </button>
                            <button
                              type="button"
                              disabled={busy || s.evaluations.length > 0}
                              title={s.evaluations.length > 0 ? "No se puede eliminar: ya tiene evaluaciones." : undefined}
                              className="text-steel hover:text-red cursor-pointer disabled:opacity-30 disabled:hover:text-steel"
                              onClick={() => deleteStore(s.id)}
                            >
                              <Trash2 size={15} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {isOpen && (
                      <div className="mt-3 pt-3 border-t border-rule space-y-2">
                        {s.evaluations.length === 0 && (
                          <div className="text-steel text-[12.5px]">Sin evaluaciones todavía.</div>
                        )}
                        {s.evaluations.length > 1 && (
                          <div className="flex items-end gap-2.5 mb-3 pb-1 overflow-x-auto">
                            {[...s.evaluations].reverse().map((e) => {
                              const risk = retentionRiskFor(e.loyaltyScore);
                              return (
                                <div key={e.id} className="flex flex-col items-center gap-1 shrink-0">
                                  <div
                                    className="w-4 rounded-t"
                                    style={{ height: `${8 + (e.loyaltyScore / 5) * 40}px`, background: risk.color }}
                                    title={`${monthLabel(e.period)}: ${e.loyaltyScore}/5 (${risk.label})`}
                                  />
                                  <div className="font-mono text-[9.5px] text-steel">{monthLabel(e.period).slice(0, 3)}</div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {s.evaluations.map((e) => {
                          const risk = retentionRiskFor(e.loyaltyScore);
                          return (
                            <div key={e.id} className="bg-cloud rounded p-3">
                              <div className="flex items-center justify-between gap-3 mb-1.5">
                                <span className="font-mono text-[11px] font-semibold text-steel">{monthLabel(e.period)}</span>
                                <div className="flex items-center gap-2">
                                  <span
                                    className="font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap"
                                    style={{ color: risk.color, border: `1px solid ${risk.color}`, background: `${risk.color}1a` }}
                                  >
                                    {risk.icon} {e.loyaltyScore}/5
                                  </span>
                                  {editable && (
                                    <button
                                      type="button"
                                      disabled={busy}
                                      className="text-steel hover:text-red cursor-pointer disabled:opacity-60"
                                      onClick={() => deleteEvaluation(s.id, e.id)}
                                    >
                                      <Trash2 size={13} />
                                    </button>
                                  )}
                                </div>
                              </div>
                              <div className="grid grid-cols-3 gap-x-3 gap-y-1 text-[11.5px] text-steel mb-1.5">
                                {DRIVER_FIELDS.map((f) => (
                                  <div key={f.key}>
                                    {f.label}: <span className="text-ink font-semibold">{e[f.key]}/5</span>
                                  </div>
                                ))}
                              </div>
                              {e.comment && <div className="text-[12.5px] text-ink/90 italic">&ldquo;{e.comment}&rdquo;</div>}
                              {e.actionPlan && (
                                <div className="text-[12px] text-ink/90 mt-1">
                                  <span className="font-semibold text-steel">Plan de acción:</span> {e.actionPlan}
                                </div>
                              )}
                              {e.growthNeeds && (
                                <div className="text-[12px] text-ink/90 mt-1">
                                  <span className="font-semibold text-steel">Necesidades de crecimiento:</span> {e.growthNeeds}
                                </div>
                              )}
                              <div className="text-[10.5px] text-steel mt-1.5">
                                {e.evaluatedByName ?? "Admin"} · {new Date(e.evaluatedAt).toLocaleDateString("es-EC")}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
