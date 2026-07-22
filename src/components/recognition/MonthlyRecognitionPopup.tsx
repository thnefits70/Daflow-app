"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { RECOGNITION_MESSAGE_SIGNATURE } from "@/lib/recognitionMessages";

type Celebration = {
  month: string;
  rank: number;
  winnerId: string;
  winnerName: string;
  winnerPhotoUrl: string | null;
  isMe: boolean;
  message?: string;
};

const CONFETTI_COLORS = ["#14C7C7", "#1E5EFF", "#F5C543", "#C4453A", "#8B5CF6", "#22C55E"];
// Mix of emoji (money bag, coin, green bill) and a styled gold "$" glyph —
// emoji alone read as "cookies falling" at a glance, the gold dollar signs
// make it unambiguously read as money raining down. Reserved for rank 1
// only — 2°/3° get a "cheer" rain instead (no money implied for them).
const COIN_EMOJI = ["💰", "🪙", "💵"];
const CHEER_EMOJI = ["🎉", "👏", "⭐", "🙌"];

// Per-rank presentation — rank 1 keeps its original gold/teal "won a bonus"
// treatment untouched; 2°/3° reuse the same layout with a silver/bronze
// accent and zero money language, confirmed 2026-07-22.
const RANK_STYLE: Record<number, { emoji: string; label: string; borderClass?: string; borderStyle?: React.CSSProperties; ringClass?: string; ringStyle?: React.CSSProperties }> = {
  1: { emoji: "🏆", label: "Colaborador Destacado", borderClass: "border-teal", ringClass: "border-teal" },
  2: { emoji: "🥈", label: "2do Lugar · Colaborador Destacado", borderClass: "border-steel", ringClass: "border-steel" },
  3: {
    emoji: "🥉",
    label: "3er Lugar · Colaborador Destacado",
    borderStyle: { borderColor: "#C97B3D" },
    ringStyle: { borderColor: "#C97B3D" },
  },
};

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

// Shared falling-emoji rain, used both for rank 1's money rain and
// rank 2/3's cheer rain — only the emoji pool (and the gold "$" glyph,
// money-only) differ.
function RainPiece({ i, emojis, withDollarGlyph }: { i: number; emojis: string[]; withDollarGlyph: boolean }) {
  const style = useMemo(
    () => ({
      left: `${Math.random() * 100}%`,
      animationDelay: `${Math.random() * 1.8}s`,
      animationDuration: `${2.6 + Math.random() * 2}s`,
      fontSize: `${16 + Math.random() * 14}px`,
    }),
    [i]
  );
  // Every 4th piece is a bold gold "$" instead of an emoji — emoji render in
  // whatever color the font gives them, so a real gold dollar sign has to be
  // a styled glyph, not an emoji character. Uses a different divisor than
  // the emoji rotation below (%3) on purpose — sharing one would make one of
  // the three emoji mathematically unreachable (its index would only ever
  // land on positions already claimed by the "$" branch).
  if (withDollarGlyph && i % 4 === 0) {
    return (
      <span className="coin-piece" style={{ ...style, color: "#D9A441", fontWeight: 800, fontFamily: "var(--font-display)", textShadow: "0 1px 2px rgba(0,0,0,.4)" }}>
        $
      </span>
    );
  }
  return (
    <span className="coin-piece" style={style}>
      {emojis[i % emojis.length]}
    </span>
  );
}

export function MonthlyRecognitionPopup() {
  const [queue, setQueue] = useState<Celebration[] | null>(null);

  useEffect(() => {
    fetch("/api/recognition/celebration")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (Array.isArray(data?.celebrations)) setQueue(data.celebrations);
      })
      .catch(() => {});
  }, []);

  const celebration = queue?.[0] ?? null;

  const dismiss = async () => {
    if (!celebration) return;
    const { month, rank } = celebration;
    setQueue((q) => (q ? q.slice(1) : q));
    await fetch("/api/recognition/celebration/seen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month, rank }),
    }).catch(() => {});
  };

  useEffect(() => {
    if (!celebration) return;
    const t = setTimeout(dismiss, 60000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [celebration?.month, celebration?.rank]);

  if (!celebration) return null;

  const firstName = celebration.winnerName.split(" ")[0] || celebration.winnerName;
  const monthLabel = formatMonth(celebration.month);
  const rankStyle = RANK_STYLE[celebration.rank] ?? RANK_STYLE[1];
  const isWinner = celebration.rank === 1;

  const headline = celebration.isMe
    ? "¡Felicidades!"
    : isWinner
      ? `${firstName} es el Colaborador Destacado`
      : `${firstName} quedó en ${rankStyle.label.split(" · ")[0]}`;

  const subtext = celebration.isMe
    ? isWinner
      ? "Ganaste un bono económico por ser uno de los mejores colaboradores de este mes."
      : `Quedaste en ${rankStyle.label.split(" · ")[0]} como Colaborador Destacado este mes — tu esfuerzo se nota.`
    : isWinner
      ? `Reconoce el esfuerzo de ${firstName} este mes — se lo ganó por mérito propio.`
      : `Felicita a ${firstName} por quedar en ${rankStyle.label.split(" · ")[0]} este mes — un gran esfuerzo.`;

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
        {celebration.isMe && isWinner && Array.from({ length: 22 }).map((_, i) => <RainPiece key={`m-${i}`} i={i} emojis={COIN_EMOJI} withDollarGlyph />)}
        {celebration.isMe && !isWinner && Array.from({ length: 18 }).map((_, i) => <RainPiece key={`h-${i}`} i={i} emojis={CHEER_EMOJI} withDollarGlyph={false} />)}
      </div>

      <div
        className={`relative bg-surface rounded-xl p-8 text-center w-full shadow-2xl ${
          celebration.isMe ? `max-w-md border-2 ${rankStyle.borderClass ?? ""}` : "max-w-sm"
        }`}
        style={{ animation: "recognition-pop 0.35s ease-out", ...(celebration.isMe ? rankStyle.borderStyle : undefined) }}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="absolute top-3 right-3 text-steel hover:text-ink cursor-pointer" onClick={dismiss} aria-label="Cerrar">
          <X size={18} />
        </button>

        <div
          className={`w-24 h-24 rounded-full overflow-hidden bg-cloud border-4 mx-auto mb-4 ${rankStyle.ringClass ?? ""}`}
          style={rankStyle.ringStyle}
        >
          {celebration.winnerPhotoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={celebration.winnerPhotoUrl} alt={celebration.winnerName} className="w-full h-full object-cover object-top" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-[28px] font-display font-bold text-steel">{firstName[0]}</div>
          )}
        </div>

        <div className="text-[13px] font-semibold uppercase tracking-wide text-teal mb-1.5">
          {rankStyle.emoji} {rankStyle.label} · {monthLabel} {rankStyle.emoji}
        </div>
        <div className="font-display text-[22px] font-bold mb-1.5">{headline}</div>
        <div className="text-[13px] text-steel">{subtext}</div>

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
