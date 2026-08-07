"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Info, Scale } from "lucide-react";
import { PILLARS, PILLAR_ACCENTS, QUESTIONS_PER_PILLAR, MAX_SCORE_PER_QUESTION, MAX_TOTAL_SCORE } from "@/lib/recognition";

const MAX_PER_PILLAR = QUESTIONS_PER_PILLAR * MAX_SCORE_PER_QUESTION;

// Confirmado 2026-08-06: TODO colaborador de nómina (no solo líderes) debe
// poder ver, sin tener que preguntarle a nadie, cómo funciona esta
// evaluación de punta a punta: quién califica a quién, cómo se arma el
// puntaje, y que es 100% por mérito — mismos pilares y misma vara para
// todos, sin importar el área. Este bloque siempre visible cubre eso; el
// desglose de los 7 pilares sigue plegado abajo (ya existía).
function RecognitionMethodology() {
  return (
    <div className="bg-surface border border-rule rounded-md p-4 mb-3">
      <div className="flex items-center gap-2 text-[13px] font-semibold mb-2.5">
        <Scale size={15} className="text-steel shrink-0" />
        ¿Cómo funciona Colaborador Destacado del Mes?
      </div>
      <div className="flex flex-col gap-2 text-[12px] text-steel leading-relaxed">
        <p>
          Es una evaluación mensual <strong className="text-ink">100% por mérito</strong>: los mismos 7 pilares y la
          misma forma de calificar para todos, sin importar el área ni el puesto.
        </p>
        <p>
          <strong className="text-ink">¿Quién evalúa a quién?</strong> El administrador evalúa a cada líder de área;
          cada líder evalúa a las personas de su propio equipo.
        </p>
        <p>
          <strong className="text-ink">¿Cómo se calcula el puntaje?</strong> Son 7 pilares y cada uno vale hasta{" "}
          {MAX_PER_PILLAR} puntos ({QUESTIONS_PER_PILLAR} preguntas de hasta {MAX_SCORE_PER_QUESTION} puntos cada
          una) — {MAX_TOTAL_SCORE} puntos en total. Cada mes se eligen al azar {QUESTIONS_PER_PILLAR} preguntas de un
          banco más amplio por pilar, así la evaluación no se siente repetitiva de un mes a otro.
        </p>
        <p>
          <strong className="text-ink">¿Cómo se interpreta el resultado?</strong> 80% o más del puntaje total =
          Excelente · 60%–79% = Bien · menos de 60% = A mejorar.
        </p>
      </div>
    </div>
  );
}

// For collaborators who never see the evaluation form itself (only leaders
// evaluate) — the only way they'd otherwise know what they're being scored
// on is if their leader happened to explain it. This shows the 7 pillars
// and what each one means, deliberately WITHOUT the question bank itself
// (those stay leader/admin-only, so they can't be gamed by memorizing them).
export function RecognitionPillarsInfo() {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mb-6">
      <RecognitionMethodology />
      <button
        type="button"
        className="w-full flex items-center justify-between gap-3 bg-surface border border-rule rounded p-3.5 cursor-pointer"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="inline-flex items-center gap-2 text-[13px] font-semibold">
          <Info size={15} className="text-steel shrink-0" />
          ¿Qué se evalúa cada mes?
        </span>
        <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-blue shrink-0">
          {expanded ? "Ocultar" : "Ver los 7 pilares"}
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      </button>

      {expanded && (
        <div className="mt-2.5">
          <div className="text-[12px] text-steel mb-3">
            Cada mes tu líder te califica en estos 7 pilares — no las preguntas exactas (esas cambian cada mes para
            que la evaluación no se sienta repetitiva), sino las áreas generales sobre las que se enfoca.
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {PILLARS.map((pillar) => {
              const accent = PILLAR_ACCENTS[pillar.key];
              return (
                <div key={pillar.key} className="bg-surface border border-rule rounded-md p-3.5" style={{ borderTopColor: accent, borderTopWidth: 3 }}>
                  <div className="font-display text-[14px] font-bold mb-1" style={{ color: accent }}>
                    {pillar.label}
                  </div>
                  <div className="text-[12px] italic text-ink mb-1.5">&ldquo;{pillar.tagline}&rdquo;</div>
                  <div className="text-[11.5px] text-steel mb-1.5">{pillar.description}</div>
                  <div className="text-[11px] text-steel/80">{pillar.why}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
