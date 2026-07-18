"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { RECOGNITION_MESSAGE_SIGNATURE } from "@/lib/recognitionMessages";

type Celebration = {
  month: string;
  winnerId: string;
  winnerName: string;
  winnerPhotoUrl: string | null;
  isMe: boolean;
  message?: string;
};

const CONFETTI_COLORS = ["#14C7C7", "#1E5EFF", "#F5C543", "#C4453A", "#8B5CF6", "#22C55E"];
const COINS = ["💰", "🪙"];

const MONTH_NAMES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
function formatMonth(month: string) {
  const [y, m] = month.split("-");
  return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
}

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

function CoinPiece({ i }: { i: number }) {
  const style = useMemo(
    () => ({
      left: `${Math.random() * 100}%`,
      animationDelay: `${Math.random() * 1.8}s`,
      animationDuration: `${2.6 + Math.random() * 2}s`,
      fontSize: `${16 + Math.random() * 14}px`,
    }),
    [i]
  );
  return (
    <span className="coin-piece" style={style}>
      {COINS[i % COINS.length]}
    </span>
  );
}

export function MonthlyRecognitionPopup() {
  const [celebration, setCelebration] = useState<Celebration | null>(null);

  useEffect(() => {
    fetch("/api/recognition/celebration")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.celebration) setCelebration(data.celebration);
      })
      .catch(() => {});
  }, []);

  const dismiss = async () => {
    if (!celebration) return;
    const month = celebration.month;
    setCelebration(null);
    await fetch("/api/recognition/celebration/seen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month }),
    }).catch(() => {});
  };

  useEffect(() => {
    if (!celebration) return;
    const t = setTimeout(dismiss, 60000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [celebration?.month]);

  if (!celebration) return null;

  const firstName = celebration.winnerName.split(" ")[0] || celebration.winnerName;
  const monthLabel = formatMonth(celebration.month);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-6" onClick={dismiss}>
      <style>{`
        @keyframes confetti-fall {
          0% { transform: translateY(-10vh) rotate(0deg); opacity: 1; }
          100% { transform: translateY(110vh) rotate(360deg); opacity: 0.9; }
        }
        .confetti-piece {
          position: absolute; top: -5vh; width: 8px; height: 14px; border-radius: 2px;
          animation-name: confetti-fall; animation-timing-function: linear; animation-iteration-count: infinite;
        }
        @keyframes coin-fall {
          0% { transform: translateY(-10vh) rotate(0deg); opacity: 1; }
          100% { transform: translateY(110vh) rotate(220deg); opacity: 0.95; }
        }
        .coin-piece {
          position: absolute; top: -8vh; animation-name: coin-fall; animation-timing-function: ease-in;
          animation-iteration-count: infinite; filter: drop-shadow(0 2px 3px rgba(0,0,0,.35));
        }
        @keyframes recognition-pop {
          0% { transform: scale(0.85); opacity: 0; } 100% { transform: scale(1); opacity: 1; }
        }
      `}</style>

      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {Array.from({ length: celebration.isMe ? 24 : 16 }).map((_, i) => (
          <ConfettiPiece key={`c-${i}`} i={i} />
        ))}
        {celebration.isMe && Array.from({ length: 22 }).map((_, i) => <CoinPiece key={`m-${i}`} i={i} />)}
      </div>

      <div
        className={`relative bg-surface rounded-xl p-8 text-center w-full shadow-2xl ${celebration.isMe ? "max-w-md border-2 border-teal" : "max-w-sm"}`}
        style={{ animation: "recognition-pop 0.35s ease-out" }}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="absolute top-3 right-3 text-steel hover:text-ink cursor-pointer" onClick={dismiss} aria-label="Cerrar">
          <X size={18} />
        </button>

        <div className="w-24 h-24 rounded-full overflow-hidden bg-cloud border-4 border-teal mx-auto mb-4">
          {celebration.winnerPhotoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={celebration.winnerPhotoUrl} alt={celebration.winnerName} className="w-full h-full object-cover object-top" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-[28px] font-display font-bold text-steel">{firstName[0]}</div>
          )}
        </div>

        <div className="text-[13px] font-semibold uppercase tracking-wide text-teal mb-1.5">
          🏆 Colaborador Destacado · {monthLabel} 🏆
        </div>
        <div className="font-display text-[22px] font-bold mb-1.5">
          {celebration.isMe ? "¡Felicidades!" : `${firstName} es el Colaborador Destacado`}
        </div>
        <div className="text-[13px] text-steel">
          {celebration.isMe
            ? "Ganaste un bono económico por ser uno de los mejores colaboradores de este mes."
            : `Reconoce el esfuerzo de ${firstName} este mes — se lo ganó por mérito propio.`}
        </div>

        {celebration.message && (
          <div className="mt-5 pt-4 border-t border-rule text-left">
            <div className="text-[13.5px] text-ink/85 italic leading-relaxed">&ldquo;{celebration.message}&rdquo;</div>
            <div className="text-[12px] text-steel font-semibold mt-2 text-right">— {RECOGNITION_MESSAGE_SIGNATURE}</div>
          </div>
        )}
      </div>
    </div>
  );
}
