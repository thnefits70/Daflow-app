"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { isProvedixHost } from "@/lib/provedixHosts";
import { endRestore, markRestoreBeforeReload, restoreScrollAfterReload } from "@/lib/rememberedState";

// Pedido 2026-10-03: Joel seguía usando una versión vieja del escáner porque
// tenía DAFLOW abierto en el celular desde antes de publicar la mejora (el
// navegador del celular "congela" la pestaña y al volver la muestra igual,
// sin cargar nada nuevo). Ahora DAFLOW revisa sola si hay versión nueva.
// Sin avisos ni botones — pedido del usuario: debe ser automático.
//
// 2026-10-15 (Michelle, la asesora humana, y Nairoby): la recarga completa
// la sacaba de la tarea que estaba gestionando (se iba a WhatsApp, volvía y
// tenía que buscar todo otra vez). Ahora:
//  - Datos al día al volver tras ≥1 min fuera: se traen por detrás
//    (router.refresh) SIN recargar — la tarea abierta, los filtros, lo
//    escrito y el lugar de la lista se quedan igual.
//  - Versión nueva: entra al cambiar de pantalla (ya se estaba saliendo, no
//    se pierde nada). En la misma pantalla solo si estuvo fuera ≥2 h y no
//    escribió nada; ahí la pantalla vuelve con su pestaña, filtros y posición
//    (useRememberedState).

const CURRENT = process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";
const POLL_MS = 5 * 60_000;
const MIN_GAP_MS = 30_000; // no preguntar más seguido que esto
const AWAY_MS = 2 * 60 * 60_000; // tiempo fuera para cargar la versión nueva en la misma pantalla
const DATA_AWAY_MS = 60_000; // tiempo fuera para traer datos al día al volver

export function AppVersionWatcher() {
  const pathname = usePathname();
  const router = useRouter();
  const staleRef = useRef(false);
  const dirtyRef = useRef(false);
  const firstPath = useRef(true);

  // Tras una recarga en la misma pantalla, volver al mismo lugar de la lista.
  useEffect(() => {
    restoreScrollAfterReload();
  }, []);

  // Cambio de pantalla con versión vieja → recarga (ya en la pantalla nueva).
  useEffect(() => {
    if (firstPath.current) {
      firstPath.current = false;
      return;
    }
    dirtyRef.current = false;
    endRestore();
    if (staleRef.current) window.location.reload();
  }, [pathname]);

  // Datos al día al volver (también en local), sin recargar la pantalla.
  useEffect(() => {
    // provedix.com (página pública, 2026-10-12): no se toca al volver.
    if (isProvedixHost(window.location.hostname) || window.location.pathname.startsWith("/pvx")) return;
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      const away = hiddenAt ? Date.now() - hiddenAt : 0;
      hiddenAt = 0;
      if (away >= DATA_AWAY_MS) router.refresh();
    };
    // El celular devolvió la pestaña "congelada" (memoria del navegador).
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) router.refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [router]);

  useEffect(() => {
    if (CURRENT === "dev") return; // en la computadora de desarrollo no aplica
    let lastCheck = 0;
    let hiddenAt = 0;

    const check = async (force = false): Promise<boolean> => {
      if (staleRef.current) return true;
      const now = Date.now();
      if (!force && now - lastCheck < MIN_GAP_MS) return false;
      lastCheck = now;
      try {
        const r = await fetch("/api/app-version", { cache: "no-store" });
        if (!r.ok) return false;
        const { version } = (await r.json()) as { version?: string };
        if (version && version !== "dev" && version !== CURRENT) {
          staleRef.current = true;
          return true;
        }
      } catch {
        // Sin conexión: se vuelve a intentar más tarde.
      }
      return false;
    };

    // Escribir algo o elegir foto/archivo (abre cámara/galería y "saca" de
    // DAFLOW) cuenta como trabajo en curso: nunca se recarga encima.
    const markDirty = () => { dirtyRef.current = true; };
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest('input[type="file"], label')) dirtyRef.current = true;
    };

    const onBack = async (wasAwayMs: number) => {
      const isStale = await check(true);
      if (isStale && wasAwayMs >= AWAY_MS && !dirtyRef.current) {
        markRestoreBeforeReload();
        window.location.reload();
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      void onBack(hiddenAt ? Date.now() - hiddenAt : 0);
    };

    const onFocus = () => { void check(); };

    document.addEventListener("input", markDirty, true);
    document.addEventListener("change", markDirty, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void check();
    }, POLL_MS);
    void check(true);

    return () => {
      document.removeEventListener("input", markDirty, true);
      document.removeEventListener("change", markDirty, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      window.clearInterval(id);
    };
  }, []);

  return null;
}
