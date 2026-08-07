"use client";

import { AlertTriangle, LogOut } from "lucide-react";
import { signOut } from "next-auth/react";
import { formatDeadline, MAX_TOTAL_SCORE } from "@/lib/recognition";
import { RecognitionPanel, type RecognitionPersonDTO } from "@/components/recognition/RecognitionPanel";
import { BrandMark } from "@/components/brand/DaflowMark";

// Confirmado 2026-08-07: metodología pedida explícitamente por el usuario —
// si un líder (o el admin, evaluando líderes) deja pasar el plazo duro (día
// 5 del mes siguiente) sin calificar a todo su equipo del mes anterior, toda
// la cuenta se bloquea: reemplaza por completo el shell normal (sidebar +
// la página que sea) y solo deja calificar. En cuanto termina de calificar
// al último que faltaba, RecognitionPanel llama router.refresh() (ya lo hace
// al guardar) y el layout server-side vuelve a calcular el bloqueo — como ya
// no falta nadie, desaparece solo, sin ningún paso extra.
export function RecognitionLockGate({
  month,
  deadline,
  people,
  emptyMessage,
  logoUrl,
}: {
  month: string;
  deadline: string;
  people: RecognitionPersonDTO[];
  emptyMessage: string;
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
      <main className="flex-1 overflow-y-auto bg-bg p-4 md:p-9">
        <div className="bg-red/10 border border-red rounded-md p-4.5 mb-5 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold text-[14px] text-red">Colaborador del mes — calificación atrasada</div>
            <div className="text-[12.5px] text-steel mt-1">
              El plazo para calificar a todo tu equipo venció el {formatDeadline(new Date(deadline))}. El resto de
              DAFLOW queda bloqueado hasta que califiques a todos los que te faltan — no se puede avanzar sin
              completar este paso.
            </div>
          </div>
        </div>
        <RecognitionPanel month={month} maxTotalScore={MAX_TOTAL_SCORE} people={people} emptyMessage={emptyMessage} />
      </main>
    </div>
  );
}
