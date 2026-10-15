"use client";

import { useEffect, useState } from "react";
import type { HandoffLock } from "@/lib/handoffLocks";

// Pedido de Jariel 2026-10-15 (aprobado por el usuario): con el bloqueo del
// ID madre, la asesora B2B solo puede usar Análisis de Mercado > Publicar en
// Dropi. Las pestañas del área de trabajo no cambian la dirección de la
// página, así que la capa de bloqueo (HandoffLockGate) y el panel de Análisis
// de Mercado se avisan entre ellos por aquí:
// - la capa comparte el bloqueo cada vez que lo revisa;
// - el panel avisa cuando "Publicar en Dropi" está abierto, y la capa se quita;
// - al guardar un ID se pide revisar el bloqueo al instante.
const LOCK_EVENT = "daflow:handoff-lock";
const PUBLISH_OPEN_EVENT = "daflow:publish-tab-open";
const REFRESH_EVENT = "daflow:handoff-lock-refresh";

type W = Window & { __handoffLock?: HandoffLock | null; __publishTabOpen?: boolean };

export function shareHandoffLock(lock: HandoffLock | null) {
  (window as W).__handoffLock = lock;
  window.dispatchEvent(new Event(LOCK_EVENT));
}

export function useSharedHandoffLock(): HandoffLock | null {
  const [lock, setLock] = useState<HandoffLock | null>(() => (typeof window === "undefined" ? null : (window as W).__handoffLock ?? null));
  useEffect(() => {
    const on = () => setLock((window as W).__handoffLock ?? null);
    window.addEventListener(LOCK_EVENT, on);
    return () => window.removeEventListener(LOCK_EVENT, on);
  }, []);
  return lock;
}

export function setPublishTabOpen(open: boolean) {
  (window as W).__publishTabOpen = open;
  window.dispatchEvent(new Event(PUBLISH_OPEN_EVENT));
}

export function usePublishTabOpen(): boolean {
  const [open, setOpen] = useState(() => (typeof window === "undefined" ? false : !!(window as W).__publishTabOpen));
  useEffect(() => {
    const on = () => setOpen(!!(window as W).__publishTabOpen);
    window.addEventListener(PUBLISH_OPEN_EVENT, on);
    return () => window.removeEventListener(PUBLISH_OPEN_EVENT, on);
  }, []);
  return open;
}

export function requestHandoffLockRefresh() {
  window.dispatchEvent(new Event(REFRESH_EVENT));
}

export function onHandoffLockRefresh(fn: () => void): () => void {
  window.addEventListener(REFRESH_EVENT, fn);
  return () => window.removeEventListener(REFRESH_EVENT, fn);
}
