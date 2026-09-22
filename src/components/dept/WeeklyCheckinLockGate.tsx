"use client";

import { usePathname, useRouter } from "next/navigation";
import { MessageSquare, Clock } from "lucide-react";

// Pantalla de bloqueo parcial cuando un líder lleva 2+ semanas sin resolver
// su feedback semanal con Mary — pedido explícito del usuario 2026-09-22.
// Reemplaza SOLO la parte administrativa de su panel (ver
// BLOCKED_STANDALONE_ROUTES en AreaGateShell.tsx y BLOCKED_TABS en
// DeptWorkspaceTabs.tsx); las tareas operativas del día a día (despachos,
// recepción de mercadería, egresos, ventas externas, compras) nunca pasan
// por este componente, para no frenar la operación. El botón abre el mismo
// widget flotante de Mary vía "?openMary=1" (ver WeeklyCheckinPanel.tsx).
export function WeeklyCheckinLockGate({ weeksStale, reason }: { weeksStale: number; reason: "stale_pending" | "no_contact" }) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <div className="max-w-xl mx-auto py-10 text-center">
      <div className="bg-surface border border-rule rounded p-8" style={{ borderLeft: "4px solid #14C7C7" }}>
        <div className="w-12 h-12 rounded-full bg-teal/15 text-teal flex items-center justify-center mx-auto mb-4">
          <Clock size={22} />
        </div>
        <div className="font-mono text-[10.5px] text-teal tracking-[.08em] mb-1.5">FEEDBACK SEMANAL PENDIENTE</div>
        <h2 className="font-display text-[19px] font-bold mb-2">
          Llevas {weeksStale} semana{weeksStale === 1 ? "" : "s"} {reason === "no_contact" ? "sin hablar con Mary" : "sin resolver esto con Mary"}
        </h2>
        <p className="text-[13px] text-steel mb-6 leading-relaxed">
          Esta sección quedó bloqueada hasta que te pongas al día con tu feedback semanal. Tus tareas del día a día
          (despachos, recepción, egresos, ventas externas, compras) siguen disponibles como siempre — solo esta
          parte administrativa queda a la espera. Si llegas a 3 semanas sin resolverlo, se bloquea la cuenta
          completa hasta que hables con Mary.
        </p>
        <button
          type="button"
          onClick={() => router.push(`${pathname}?openMary=1`)}
          className="inline-flex items-center gap-2 bg-teal text-white text-[13px] font-semibold px-5 py-2.5 rounded cursor-pointer hover:opacity-90"
        >
          <MessageSquare size={15} /> Hablar con Mary ahora
        </button>
      </div>
    </div>
  );
}
