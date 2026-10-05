"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

// Pedido 2026-10-03: Joel seguía usando una versión vieja del escáner porque
// tenía DAFLOW abierto en el celular desde antes de publicar la mejora (el
// navegador del celular "congela" la pestaña y al volver la muestra igual,
// sin cargar nada nuevo). Ahora DAFLOW revisa solo si hay versión nueva:
//  - al cambiar de pantalla → carga la nueva al instante (igual se salía de
//    esa pantalla, no se pierde nada);
//  - al volver a DAFLOW tras un rato fuera → se recarga sola, salvo que la
//    persona haya escrito algo en esa pantalla (para no borrárselo): ahí
//    espera al siguiente cambio de pantalla.
// Sin avisos ni botones — pedido del usuario: debe ser automático.
// 2026-10-05: también los DATOS. Se quitó el botón "Refrescar" (pedido del
// usuario: nada manual). Al volver a DAFLOW tras ≥1 min fuera se recarga
// sola con datos al día, aunque no haya versión nueva — salvo que se haya
// escrito algo o elegido una foto/archivo en esa pantalla.

const CURRENT = process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";
const POLL_MS = 5 * 60_000;
const MIN_GAP_MS = 30_000; // no preguntar más seguido que esto
const AWAY_MS = 30_000; // tiempo fuera para recargar sola al volver (versión nueva)
const DATA_AWAY_MS = 60_000; // tiempo fuera para recargar sola al volver (datos al día)

export function AppVersionWatcher() {
  const pathname = usePathname();
  const staleRef = useRef(false);
  const dirtyRef = useRef(false);
  const firstPath = useRef(true);

  // Cambio de pantalla con versión vieja → recarga (ya en la pantalla nueva).
  useEffect(() => {
    if (firstPath.current) {
      firstPath.current = false;
      return;
    }
    dirtyRef.current = false;
    if (staleRef.current) window.location.reload();
  }, [pathname]);

  // Datos al día al volver (también en local). Elegir foto/archivo abre la
  // cámara o la galería y "saca" de DAFLOW: eso cuenta como escrito, para no
  // recargar justo cuando vuelve con la foto.
  useEffect(() => {
    let hiddenAt = 0;
    const markDirty = () => { dirtyRef.current = true; };
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest('input[type="file"], label')) dirtyRef.current = true;
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      const away = hiddenAt ? Date.now() - hiddenAt : 0;
      hiddenAt = 0;
      if (away >= DATA_AWAY_MS && !dirtyRef.current) window.location.reload();
    };
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted && !dirtyRef.current) window.location.reload();
    };
    document.addEventListener("input", markDirty, true);
    document.addEventListener("change", markDirty, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("input", markDirty, true);
      document.removeEventListener("change", markDirty, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

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

    const onInput = () => { dirtyRef.current = true; };

    const onBack = async (wasAwayMs: number) => {
      const isStale = await check(true);
      if (isStale && wasAwayMs >= AWAY_MS && !dirtyRef.current) window.location.reload();
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      void onBack(hiddenAt ? Date.now() - hiddenAt : 0);
    };

    // El celular devolvió la pestaña "congelada" (memoria del navegador).
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) void onBack(AWAY_MS);
    };

    const onFocus = () => { void check(); };

    document.addEventListener("input", onInput, true);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("focus", onFocus);
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void check();
    }, POLL_MS);
    void check(true);

    return () => {
      document.removeEventListener("input", onInput, true);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("focus", onFocus);
      window.clearInterval(id);
    };
  }, []);

  return null;
}
