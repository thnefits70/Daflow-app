"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, ChevronDown, ChevronUp, PhoneCall } from "lucide-react";
import { Combobox } from "@/components/ui/Combobox";
import { retentionRiskFor } from "@/lib/storeFeedbackCalc";

type EvaluationDTO = {
  id: string;
  period: string;
  loyaltyScore: number;
  fulfillmentScore: number;
  qualityScore: number;
  stockScore: number;
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

const DRIVER_FIELDS = [
  {
    key: "fulfillmentScore",
    label: "Cumplimiento de pedidos",
    question: "¿Te hemos estado despachando a tiempo y completo?",
  },
  {
    key: "qualityScore",
    label: "Calidad del producto",
    question: "¿Cómo ha estado la calidad de lo que te enviamos?",
  },
  {
    key: "stockScore",
    label: "Disponibilidad de stock",
    question: "¿Has encontrado lo que necesitas en stock cuando lo pides?",
  },
  {
    key: "responseTimeScore",
    label: "Tiempo de respuesta ante problemas",
    question: "Cuando ha habido un problema, ¿qué tan rápido te lo resolvimos?",
  },
  {
    key: "commercialTermsScore",
    label: "Condiciones comerciales",
    question: "¿Cómo te sientes con precios, crédito y condiciones de pago?",
  },
  {
    key: "communicationScore",
    label: "Atención y comunicación",
    question: "¿Cómo ha sido la atención de tu asesor o asesora?",
  },
] as const;

// Guion de referencia para las llamadas de Nairoby — mismos 6 pilares que el
// formulario de abajo, en el mismo orden, para que la llamada y el registro
// coincidan paso a paso. Pensado para durar menos de 5 minutos.
const CALL_SCRIPT_STEPS = [
  {
    time: "~30 seg",
    title: "Apertura",
    body: "“Hola [nombre], soy Nairoby de Provedix. Te llamo rapidito, menos de 5 minutos, para saber cómo te ha ido con nosotros este mes y ver en qué podemos mejorar.”",
  },
  {
    time: "~30 seg",
    title: "Fidelización (pregunta general)",
    body: "“En una escala del 0 al 10, ¿qué tan probable es que sigas comprándonos en los próximos meses?” — esto es la Fidelización del formulario.",
  },
  {
    time: "~2 min",
    title: "Los 6 pilares (rapid-fire, ~20 seg cada uno)",
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

export function StoreFeedbackPanel({ stores }: { stores: StoreDTO[] }) {
  const router = useRouter();
  const [storeName, setStoreName] = useState("");
  const [period, setPeriod] = useState(prevMonthStr());
  const [loyaltyScore, setLoyaltyScore] = useState("8");
  const [scores, setScores] = useState<Record<(typeof DRIVER_FIELDS)[number]["key"], string>>({
    fulfillmentScore: "4",
    qualityScore: "4",
    stockScore: "4",
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

  const activeStores = stores.filter((s) => s.isActive);

  const submit = async () => {
    const name = storeName.trim();
    if (!name) return setErr("Escribe o elige el nombre de la tienda.");
    const loyalty = Number(loyaltyScore);
    if (Number.isNaN(loyalty) || loyalty < 0 || loyalty > 10) return setErr("La fidelización debe ser un número entre 0 y 10.");
    for (const f of DRIVER_FIELDS) {
      const v = Number(scores[f.key]);
      if (Number.isNaN(v) || v < 1 || v > 5) return setErr(`${f.label} debe estar entre 1 y 5.`);
    }
    setErr("");
    setBusy(true);

    let storeId = stores.find((s) => s.name.toLowerCase() === name.toLowerCase())?.id;
    if (!storeId) {
      const res = await fetch("/api/stores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
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
        actionPlan: actionPlan.trim() || undefined,
        growthNeeds: growthNeeds.trim() || undefined,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      return setErr(data?.error ?? "No se pudo guardar la evaluación.");
    }
    setStoreName("");
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
        Registra el feedback de cada llamada a una tienda: fidelización (0-10, "¿qué tan probable es que sigas
        comprándonos?") y los KPIs que explican ese resultado (1-5 cada uno). El promedio de todas las tiendas
        evaluadas cada mes es lo que se muestra públicamente en KPIs Generales e Inicio.
      </div>

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
                  {step.title.startsWith("Los 6 pilares") && (
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
        <label className="block mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">Tienda</label>
        <Combobox
          value={storeName}
          onChange={setStoreName}
          options={activeStores.map((s) => ({ id: s.id, name: s.name }))}
          placeholder="Escribe el nombre — si no existe, se crea"
          className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px] mb-3"
        />

        <div className="grid grid-cols-2 gap-3 mb-3">
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
          <div>
            <label className="block mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">
              Fidelización (0-10) — ¿seguirá comprándonos?
            </label>
            <input
              type="number"
              min={0}
              max={10}
              className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px]"
              value={loyaltyScore}
              onChange={(e) => setLoyaltyScore(e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-3">
          {DRIVER_FIELDS.map((f) => (
            <div key={f.key}>
              <label className="block mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">
                {f.label} (1-5)
              </label>
              <input
                type="number"
                min={1}
                max={5}
                className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px]"
                value={scores[f.key]}
                onChange={(e) => setScores((s) => ({ ...s, [f.key]: e.target.value }))}
              />
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
              Plan de acción (opcional)
            </label>
            <textarea
              className="w-full rounded border border-rule px-2.5 py-2 text-[13px]"
              rows={2}
              placeholder="¿Qué vamos a hacer este mes para fortalecer la relación?"
              value={actionPlan}
              onChange={(e) => setActionPlan(e.target.value)}
            />
          </div>
          <div>
            <label className="block mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">
              Necesidades de crecimiento (opcional)
            </label>
            <textarea
              className="w-full rounded border border-rule px-2.5 py-2 text-[13px]"
              rows={2}
              placeholder="¿Qué necesita esta tienda de nosotros para crecer? (stock, apoyo creativo, tiempos...)"
              value={growthNeeds}
              onChange={(e) => setGrowthNeeds(e.target.value)}
            />
          </div>
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

      {stores.length === 0 ? (
        <div className="border-[1.5px] border-dashed border-rule rounded-md p-8.5 text-center text-steel text-[13.5px]">
          Aún no hay tiendas evaluadas.
        </div>
      ) : (
        <div className="space-y-2.5">
          {stores.map((s) => {
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
                      <div className={`font-semibold text-[14px] ${!s.isActive ? "opacity-60" : ""}`}>{s.name}</div>
                      <div className="text-[11.5px] text-steel">
                        {s.evaluations.length} evaluación{s.evaluations.length === 1 ? "" : "es"}
                        {latest && ` · última: ${monthLabel(latest.period)} · fidelización ${latest.loyaltyScore}/10`}
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
                                style={{ height: `${8 + (e.loyaltyScore / 10) * 40}px`, background: risk.color }}
                                title={`${monthLabel(e.period)}: ${e.loyaltyScore}/10 (${risk.label})`}
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
                                {risk.icon} {e.loyaltyScore}/10
                              </span>
                              <button
                                type="button"
                                disabled={busy}
                                className="text-steel hover:text-red cursor-pointer disabled:opacity-60"
                                onClick={() => deleteEvaluation(s.id, e.id)}
                              >
                                <Trash2 size={13} />
                              </button>
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
    </div>
  );
}
