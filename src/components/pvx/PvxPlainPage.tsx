/* eslint-disable @next/next/no-html-link-for-pages -- en provedix.com "/" la arma el proxy (reescritura a /pvx): se navega con recarga completa a propósito. */
import Image from "next/image";
import { PRIVACY_URL } from "@/lib/pvxFaq";

// Marco simple para las páginas sueltas de provedix.com (privacidad y "no
// encontrado", 2026-10-16): barra oscura con el logo, contenido y pie corto.
// El logo y "Volver" llevan a la portada (provedix.com/).
export function PvxPlainPage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--pvx-paper)]">
      <header className="bg-[var(--pvx-night)]">
        <nav className="mx-auto flex max-w-[1240px] items-center justify-between gap-4 px-4 py-5 sm:px-8 sm:py-6" aria-label="Principal">
          <a href="/" aria-label="Provedix, inicio" className="shrink-0">
            <Image src="/pvx/brand/wordmark-white.png" alt="Provedix" width={720} height={135} priority className="h-[20px] w-auto sm:h-[26px]" />
          </a>
          <a
            href="/"
            className="pvx-press inline-flex items-center rounded-full bg-[var(--pvx-orange)] px-4 py-2 text-[13.5px] font-bold text-white hover:bg-[var(--pvx-orange-press)]"
          >
            Ver productos
          </a>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-[760px] flex-1 px-4 py-16 sm:px-8 sm:py-24">{children}</main>
      <footer className="bg-[var(--pvx-night)] text-white/60">
        <div className="mx-auto flex max-w-[1240px] flex-col gap-2 px-4 py-8 text-[13px] sm:flex-row sm:justify-between sm:px-8">
          <p>Provedix · Guayaquil, Ecuador</p>
          <p className="flex gap-4">
            <a href="/" className="hover:text-white">
              Inicio
            </a>
            <a href={PRIVACY_URL} className="hover:text-white">
              Política de privacidad
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
