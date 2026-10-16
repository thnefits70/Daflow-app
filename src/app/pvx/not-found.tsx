/* eslint-disable @next/next/no-html-link-for-pages -- en provedix.com "/" la arma el proxy (reescritura a /pvx): se navega con recarga completa a propósito. */
import type { Metadata } from "next";
import { PvxPlainPage } from "@/components/pvx/PvxPlainPage";

// Página "no encontrado" de provedix.com (pedido del usuario 2026-10-16): en
// vez de un error en blanco, la marca Provedix y caminos para seguir.
export const metadata: Metadata = {
  title: "Página no encontrada | Provedix",
  robots: { index: false, follow: true },
};

export default function PvxNotFound() {
  return (
    <PvxPlainPage>
      <div className="flex flex-col items-start py-8">
        <p className="pvx-display pvx-num text-[96px] leading-none text-[var(--pvx-orange)] sm:text-[140px]">404</p>
        <h1 className="pvx-display mt-6 text-[34px] sm:text-[48px]">Esta página no existe</h1>
        <p className="mt-4 max-w-[520px] text-[17px] leading-relaxed text-[var(--pvx-ink-2)]">
          Puede que el enlace esté mal escrito o que la página ya no exista. Los productos ganadores siguen aquí.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <a
            href="/#productos"
            className="pvx-press inline-flex items-center rounded-full bg-[var(--pvx-orange)] px-6 py-3.5 text-[15px] font-bold text-white hover:bg-[var(--pvx-orange-press)]"
          >
            Ver productos ganadores
          </a>
          <a
            href="/calculadora"
            className="pvx-press inline-flex items-center rounded-full bg-[var(--pvx-paper-2)] px-6 py-3.5 text-[15px] font-bold hover:bg-[var(--pvx-ink)] hover:text-white"
          >
            Calcular mi ganancia
          </a>
          <a
            href="/michelle"
            className="pvx-press inline-flex items-center rounded-full bg-[var(--pvx-paper-2)] px-6 py-3.5 text-[15px] font-bold hover:bg-[var(--pvx-ink)] hover:text-white"
          >
            Preguntar a Michelle IA
          </a>
        </div>
      </div>
    </PvxPlainPage>
  );
}
