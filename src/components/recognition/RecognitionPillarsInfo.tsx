"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Info } from "lucide-react";
import { PILLARS, PILLAR_ACCENTS } from "@/lib/recognition";

// For collaborators who never see the evaluation form itself (only leaders
// evaluate) — the only way they'd otherwise know what they're being scored
// on is if their leader happened to explain it. This shows the 7 pillars
// and what each one means, deliberately WITHOUT the question bank itself
// (those stay leader/admin-only, so they can't be gamed by memorizing them).
export function RecognitionPillarsInfo() {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mb-6">
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
