"use client";

import { useEffect, useMemo, useState } from "react";
import { X, Sparkles } from "lucide-react";

type Celebration = { grantId: string; type: string; label: string; note: string | null; message: string; signature: string };

const CONFETTI_COLORS = ["#14C7C7", "#1E5EFF", "#F5C543", "#C4453A", "#8B5CF6", "#22C55E"];
const AMOUNTS: Record<string, number> = { ADICIONAL: 50, PRODUCTIVIDAD: 100, MERITO: 150 };

function ConfettiPiece({ i }: { i: number }) {
  const style = useMemo(
    () => ({
      left: `${Math.random() * 100}%`,
      backgroundColor: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      animationDelay: `${Math.random() * 1.4}s`,
      animationDuration: `${2.2 + Math.random() * 1.8}s`,
      transform: `rotate(${Math.random() * 360}deg)`,
    }),
    [i]
  );
  return <span className="ceo-bonus-confetti-piece" style={style} />;
}

// Confirmado 2026-08-14: mismo patrón exacto que BirthdayPopup.tsx —
// confeti, cola de items, auto-cierra a los 60s, marca "visto" al cerrar.
// Confidencial: solo se llama /api/ceo-bonuses/unseen, que ya filtra a
// "solo lo del propio viewer" server-side.
export function CeoBonusPopup() {
  const [queue, setQueue] = useState<Celebration[] | null>(null);

  useEffect(() => {
    fetch("/api/ceo-bonuses/unseen")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.celebrations) setQueue(data.celebrations);
      })
      .catch(() => {});
  }, []);

  const current = queue?.[0] ?? null;

  const dismiss = async () => {
    if (!current) return;
    const grantId = current.grantId;
    setQueue((q) => (q ? q.slice(1) : q));
    await fetch("/api/ceo-bonuses/seen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grantId }),
    }).catch(() => {});
  };

  useEffect(() => {
    if (!current) return;
    const t = setTimeout(dismiss, 60000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.grantId]);

  if (!current) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-6" onClick={dismiss}>
      <style>{`
        @keyframes ceo-bonus-confetti-fall {
          0% { transform: translateY(-10vh) rotate(0deg); opacity: 1; }
          100% { transform: translateY(110vh) rotate(360deg); opacity: 0.9; }
        }
        .ceo-bonus-confetti-piece {
          position: absolute;
          top: -5vh;
          width: 8px;
          height: 14px;
          border-radius: 2px;
          animation-name: ceo-bonus-confetti-fall;
          animation-timing-function: linear;
          animation-iteration-count: infinite;
        }
        @keyframes ceo-bonus-pop {
          0% { transform: scale(0.85); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>

      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {Array.from({ length: 28 }).map((_, i) => (
          <ConfettiPiece key={i} i={i} />
        ))}
      </div>

      <div
        className="relative bg-surface rounded-xl p-8 text-center w-full max-w-md shadow-2xl"
        style={{ animation: "ceo-bonus-pop 0.35s ease-out" }}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="absolute top-3 right-3 text-steel hover:text-ink cursor-pointer" onClick={dismiss} aria-label="Cerrar">
          <X size={18} />
        </button>
        <div className="w-20 h-20 rounded-full bg-gold/15 flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: "#D9A44126" }}>
          <Sparkles size={34} style={{ color: "#D9A441" }} />
        </div>
        <div className="text-[13px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#D9A441" }}>
          🎉 ¡Felicitaciones! 🎉
        </div>
        <div className="font-display text-[22px] font-bold mb-1.5">
          {current.label} — ${AMOUNTS[current.type] ?? ""}
        </div>
        {current.note && <div className="text-[13px] text-steel mb-3">{current.note}</div>}
        <div className="mt-5 pt-4 border-t border-rule text-left">
          <div className="text-[13.5px] text-ink/85 italic leading-relaxed">“{current.message}”</div>
          <div className="text-[12px] text-steel font-semibold mt-2 text-right">— {current.signature}</div>
        </div>
        <div className="text-[10.5px] text-steel-dim mt-4">Este bono ya viene incluido en tu próxima quincena — es confidencial, solo vos lo ves.</div>
      </div>
    </div>
  );
}
