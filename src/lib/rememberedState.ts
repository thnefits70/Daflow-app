"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";

// Pedido 2026-10-15 (Michelle, la asesora humana, y Nairoby): cuando DAFLOW
// se recargaba sola, la persona perdía la pestaña, el filtro y el lugar de la
// lista en que estaba gestionando su pendiente. Cada pantalla guarda aquí (en
// la memoria de esa pestaña del navegador) su pestaña/filtro/búsqueda; si
// AppVersionWatcher tiene que recargar EN LA MISMA pantalla, marca antes la
// recarga y al volver todo queda como estaba (también la posición de la lista).
// Si la persona entra a la pantalla de forma normal (menú, enlace), arranca
// como siempre: no se le "pega" un filtro de otra visita.

const FLAG = "daflow:restore";
const SCROLL = "daflow:restore-scroll";
const PREFIX = "daflow:rs:";

let restoreHref: string | null | undefined; // undefined = aún no leído

function hrefNow() {
  return window.location.pathname + window.location.search;
}

function isRestoring(): boolean {
  if (typeof window === "undefined") return false;
  if (restoreHref === undefined) {
    try {
      restoreHref = sessionStorage.getItem(FLAG);
      sessionStorage.removeItem(FLAG);
    } catch {
      restoreHref = null;
    }
  }
  return restoreHref != null && restoreHref === hrefNow();
}

/** Se llama al cambiar de pantalla: lo recordado ya no se vuelve a aplicar. */
export function endRestore() {
  restoreHref = null;
}

function scrollBox(): HTMLElement {
  const main = document.querySelector("main");
  if (main && main.scrollHeight > main.clientHeight) return main;
  return document.scrollingElement as HTMLElement;
}

/** Justo antes de recargar en la misma pantalla. */
export function markRestoreBeforeReload() {
  try {
    sessionStorage.setItem(FLAG, hrefNow());
    sessionStorage.setItem(SCROLL, JSON.stringify({ href: hrefNow(), y: scrollBox().scrollTop }));
  } catch {
    // Navegador sin almacenamiento: recarga igual, sin recordar.
  }
}

/** Después de una recarga marcada, vuelve al mismo lugar de la lista (las
 *  listas cargan sus datos un poco después, así que reintenta unos segundos). */
export function restoreScrollAfterReload() {
  if (!isRestoring()) return;
  let saved: { href: string; y: number } | null = null;
  try {
    saved = JSON.parse(sessionStorage.getItem(SCROLL) ?? "null");
    sessionStorage.removeItem(SCROLL);
  } catch {
    return;
  }
  if (!saved || saved.href !== hrefNow() || !saved.y) return;
  const y = saved.y;
  let stop = false;
  const cancel = () => { stop = true; };
  window.addEventListener("wheel", cancel, { once: true, passive: true });
  window.addEventListener("touchstart", cancel, { once: true, passive: true });
  const started = Date.now();
  const tick = () => {
    if (stop) return;
    const box = scrollBox();
    box.scrollTop = y;
    if (Math.abs(box.scrollTop - y) < 2 || Date.now() - started > 5000) return;
    window.setTimeout(tick, 200);
  };
  window.setTimeout(tick, 100);
}

const noopSubscribe = () => () => {};

/** Igual que useState, pero la pantalla lo recuerda si DAFLOW se recarga
 *  sola. `key` debe ser único dentro de la pantalla. Solo para valores
 *  simples (pestaña, filtro, texto de búsqueda). */
export function useRememberedState<T>(key: string, initialArg: T | (() => T)): [T, (next: T | ((prev: T) => T)) => void] {
  const pathname = usePathname();
  const [initial] = useState(initialArg);
  const storageKey = PREFIX + pathname + ":" + key;

  const restoredRaw = useSyncExternalStore(
    noopSubscribe,
    () => {
      if (!isRestoring()) return null;
      try {
        return sessionStorage.getItem(storageKey);
      } catch {
        return null;
      }
    },
    () => null,
  );
  const restored = useMemo<{ v: T } | null>(() => {
    if (restoredRaw == null) return null;
    try {
      return { v: JSON.parse(restoredRaw) as T };
    } catch {
      return null;
    }
  }, [restoredRaw]);

  const [local, setLocal] = useState<{ v: T } | null>(null);

  // Entrada normal a la pantalla: se olvida lo de una visita anterior.
  useEffect(() => {
    if (isRestoring()) return;
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      // sin almacenamiento
    }
  }, [storageKey]);

  const base = restored ? restored.v : initial;
  const value = local ? local.v : base;

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setLocal((prev) => {
        const cur = prev ? prev.v : base;
        const v = typeof next === "function" ? (next as (p: T) => T)(cur) : next;
        try {
          sessionStorage.setItem(storageKey, JSON.stringify(v));
        } catch {
          // sin almacenamiento
        }
        return { v };
      });
    },
    [base, storageKey],
  );

  return [value, set];
}
