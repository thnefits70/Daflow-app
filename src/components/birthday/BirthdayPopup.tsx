"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";

type Celebrant = { id: string; name: string; photoUrl: string | null; isMe: boolean };

const CONFETTI_COLORS = ["#14C7C7", "#1E5EFF", "#F5C543", "#C4453A", "#8B5CF6", "#22C55E"];

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
  return <span className="confetti-piece" style={style} />;
}

export function BirthdayPopup() {
  const [queue, setQueue] = useState<Celebrant[] | null>(null);

  useEffect(() => {
    fetch("/api/birthdays/today")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.celebrants) setQueue(data.celebrants);
      })
      .catch(() => {});
  }, []);

  const current = queue?.[0] ?? null;

  const dismiss = async () => {
    if (!current) return;
    const celebrantId = current.id;
    setQueue((q) => (q ? q.slice(1) : q));
    await fetch("/api/birthdays/seen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ celebrantId }),
    }).catch(() => {});
  };

  useEffect(() => {
    if (!current) return;
    const t = setTimeout(dismiss, 10000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  if (!current) return null;

  const firstName = current.name.split(" ")[0] || current.name;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-6" onClick={dismiss}>
      <style>{`
        @keyframes confetti-fall {
          0% { transform: translateY(-10vh) rotate(0deg); opacity: 1; }
          100% { transform: translateY(110vh) rotate(360deg); opacity: 0.9; }
        }
        .confetti-piece {
          position: absolute;
          top: -5vh;
          width: 8px;
          height: 14px;
          border-radius: 2px;
          animation-name: confetti-fall;
          animation-timing-function: linear;
          animation-iteration-count: infinite;
        }
        @keyframes birthday-pop {
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
        className="relative bg-surface rounded-xl p-8 text-center max-w-sm w-full shadow-2xl"
        style={{ animation: "birthday-pop 0.35s ease-out" }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="absolute top-3 right-3 text-steel hover:text-ink cursor-pointer"
          onClick={dismiss}
          aria-label="Cerrar"
        >
          <X size={18} />
        </button>
        <div className="w-24 h-24 rounded-full overflow-hidden bg-cloud border-4 border-teal mx-auto mb-4">
          {current.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={current.photoUrl} alt={current.name} className="w-full h-full object-cover object-top" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-[28px] font-display font-bold text-steel">
              {firstName[0]}
            </div>
          )}
        </div>
        <div className="text-[13px] font-semibold uppercase tracking-wide text-teal mb-1.5">
          🎉 ¡Feliz cumpleaños! 🎉
        </div>
        <div className="font-display text-[22px] font-bold mb-1.5">
          {current.isMe ? "¡Feliz cumpleaños!" : `Hoy es el cumpleaños de ${firstName}`}
        </div>
        <div className="text-[13px] text-steel">
          {current.isMe ? "Que tengas un excelente día 🎂" : `Un saludo le alegrará el día a ${firstName}.`}
        </div>
      </div>
    </div>
  );
}
