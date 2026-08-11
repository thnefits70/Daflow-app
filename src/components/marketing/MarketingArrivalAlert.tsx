"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PackageCheck, X } from "lucide-react";

const SEEN_KEY = "daflow.marketingArrivalsSeen";
const POLL_MS = 25000;

function loadSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}
function saveSeen(ids: Set<string>) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...ids]));
  } catch {
    // localStorage no disponible — el aviso igual funciona, solo puede repetirse
  }
}

// Sonido corto generado con Web Audio API — sin archivo de audio nuevo que
// mantener. Dos tonos suaves en vez de un beep seco.
function playChime() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    [880, 1175].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + i * 0.14);
      gain.gain.linearRampToValueAtTime(0.08, now + i * 0.14 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.14 + 0.32);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.14);
      osc.stop(now + i * 0.14 + 0.34);
    });
    setTimeout(() => ctx.close().catch(() => null), 900);
  } catch {
    // Navegador bloqueó el audio (sin interacción previa) — no es crítico, el push del sistema ya suena.
  }
}

// Confirmado 2026-08-08: pedido explícito del usuario — un aviso DENTRO de
// la pantalla (no solo la notificación del sistema) con sonido, para quien
// ya tiene DAFLOW abierto sentado en la computadora. Vercel no tiene
// websockets/SSE persistentes en el plan actual, así que esto sondea cada
// 25s — no es tiempo real perfecto, pero alcanza para "me di cuenta en el
// momento" sin nueva infraestructura de servidor.
export function MarketingArrivalAlert({ canConfirmDesign, canConfirmAdvisor }: { canConfirmDesign: boolean; canConfirmAdvisor: boolean }) {
  const router = useRouter();
  const [newCount, setNewCount] = useState(0);
  const seenRef = useRef<Set<string> | null>(null);
  const firstPollRef = useRef(true);

  useEffect(() => {
    if (!canConfirmDesign && !canConfirmAdvisor) return;
    if (seenRef.current === null) seenRef.current = loadSeen();

    async function poll() {
      const res = await fetch("/api/marketing-arrivals/pending-count").catch(() => null);
      if (!res?.ok) return;
      const data = await res.json().catch(() => null);
      const ids: string[] = data?.pendingIds ?? [];
      const seen = seenRef.current!;

      if (firstPollRef.current) {
        // Primera carga de la sesión — no avisa de lo que ya estaba
        // pendiente antes de abrir DAFLOW, solo de lo que llega DESPUÉS.
        ids.forEach((id) => seen.add(id));
        saveSeen(seen);
        firstPollRef.current = false;
        return;
      }

      const fresh = ids.filter((id) => !seen.has(id));
      if (fresh.length > 0) {
        ids.forEach((id) => seen.add(id));
        saveSeen(seen);
        setNewCount((n) => n + fresh.length);
        playChime();
      }
    }

    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => clearInterval(interval);
  }, [canConfirmDesign, canConfirmAdvisor]);

  if (newCount === 0) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 bg-navy border border-teal/50 rounded-md shadow-lg px-4 py-3 flex items-center gap-3 max-w-xs">
      <PackageCheck size={20} className="text-teal shrink-0" />
      <div className="flex-1 text-[12.5px] text-white">
        {newCount === 1 ? "Llegó mercadería nueva a bodega" : `Llegaron ${newCount} mercaderías nuevas a bodega`}
        <button
          type="button"
          className="block text-teal font-semibold underline cursor-pointer mt-0.5"
          onClick={() => { setNewCount(0); router.push("/area/workspace?tab=llegadas"); }}
        >
          Ver detalles
        </button>
      </div>
      <button type="button" className="text-steel hover:text-white cursor-pointer shrink-0" onClick={() => setNewCount(0)}>
        <X size={14} />
      </button>
    </div>
  );
}
