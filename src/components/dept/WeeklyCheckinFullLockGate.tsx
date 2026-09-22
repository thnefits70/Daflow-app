"use client";

import { AlertTriangle, LogOut } from "lucide-react";
import { signOut } from "next-auth/react";
import { BrandMark } from "@/components/brand/DaflowMark";
import { WeeklyCheckinPanel } from "@/components/shared/WeeklyCheckinPanel";

// Bloqueo TOTAL — pedido explícito del usuario 2026-09-22: a partir de 3
// semanas sin resolver el feedback semanal (ver
// WEEKLY_CHECKIN_FULL_LOCKOUT_WEEKS en weeklyCheckin.ts), el bloqueo
// operativo parcial (WeeklyCheckinLockGate.tsx) escala a esto — reemplaza
// TODO el shell (mismo patrón que RecognitionLockGate.tsx, sin sidebar ni
// nada más) y lo único que puede hacer el líder es escribirle a Mary, acá
// mismo (WeeklyCheckinPanel en modo embedded). En cuanto Mary registra su
// reporte, el layout server-side recalcula el bloqueo y esta pantalla
// desaparece sola, sin ningún paso extra — mismo mecanismo que
// RecognitionLockGate.
export function WeeklyCheckinFullLockGate({
  weeksStale,
  reason,
  logoUrl,
}: {
  weeksStale: number;
  reason: "stale_pending" | "no_contact";
  logoUrl?: string | null;
}) {
  return (
    <div className="flex flex-col md:flex-row h-screen min-h-0">
      <div className="w-full md:w-[230px] shrink-0 bg-navy text-[#EDEFE9] flex flex-row md:flex-col items-center md:items-stretch justify-between md:justify-start px-4.5 py-3.5 md:py-5 gap-4">
        <div className="flex items-center gap-2.5">
          <BrandMark logoUrl={logoUrl} size={26} light chip={!!logoUrl} />
          <span className="font-display font-bold text-[15px] text-white">DAFLOW</span>
        </div>
        <div className="hidden md:block text-[10px] tracking-[.14em] uppercase text-red">Cuenta bloqueada</div>
        <button
          type="button"
          className="flex items-center gap-2 text-[#C9CFC5] hover:text-white text-[12.5px] cursor-pointer md:mt-auto"
          onClick={() => signOut({ callbackUrl: "/login" })}
        >
          <LogOut size={14} /> Cerrar sesión
        </button>
      </div>
      <main className="flex-1 overflow-y-auto bg-bg p-4 md:p-9 flex flex-col min-h-0">
        <div className="bg-red/10 border border-red rounded-md p-4.5 mb-5 flex items-start gap-3 shrink-0">
          <AlertTriangle size={18} className="text-red shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold text-[14px] text-red">
              Feedback semanal — {weeksStale} semanas {reason === "no_contact" ? "sin hablar con Mary" : "sin resolver un pendiente"}
            </div>
            <div className="text-[12.5px] text-steel mt-1">
              Toda tu cuenta quedó bloqueada hasta que completes tu feedback semanal con Mary, acá mismo. En cuanto
              termines, se desbloquea todo automáticamente — nunca debería tomarte más de 15 minutos.
            </div>
          </div>
        </div>
        <WeeklyCheckinPanel embedded />
      </main>
    </div>
  );
}
