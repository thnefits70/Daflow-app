"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Pedido de Yair 2026-09-30 (también para la cuenta de Daniel): un punto rojo
// arriba a la derecha de cada pestaña de "Mi área de trabajo" mientras haya
// algo sin atender ahí. Sale de dos fuentes que ya existen:
//  - Pendientes de Inicio (/api/pending-tasks): el punto sigue hasta que la
//    tarea se termina, porque el pendiente deja de salir solo.
//  - Avisos de la campanita sin abrir (/api/notifications): el punto se apaga
//    al entrar a esa pestaña (o al abrir la campanita).
// Solo cuenta lo que apunta a ESTA página (/area/workspace o
// /admin/dept/<id>) con ?tab=...; los pendientes sin ?tab se ubican por tipo.
const TAB_BY_PENDING_TYPE: Record<string, string> = {
  pagos_recordatorios: "pagos",
  pedidos_despachados: "semanal",
  fillrate_justificacion_pendiente: "semanal",
  feedback: "feedback",
};

type PendingItem = { type?: string; href: string };
type NotificationRow = { url: string | null; readAt: string | null };

function tabOf(url: string | null, pathname: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url, window.location.origin);
    if (u.pathname !== pathname) return null;
    return u.searchParams.get("tab");
  } catch {
    return null;
  }
}

export function useWorkspaceTabDots(currentTab: string) {
  // La pestaña que ya está a la vista no necesita punto por avisos: se marcan
  // como vistos apenas llegan (ej. se entró desde el link del aviso).
  const currentTabRef = useRef(currentTab);
  useEffect(() => {
    currentTabRef.current = currentTab;
  });
  const [pendingTabs, setPendingTabs] = useState<Set<string>>(new Set());
  const [notifTabs, setNotifTabs] = useState<Set<string>>(new Set());

  const load = useCallback(() => {
    const pathname = window.location.pathname;
    fetch("/api/pending-tasks")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { items?: PendingItem[] } | null) => {
        const s = new Set<string>();
        for (const item of d?.items ?? []) {
          let samePage = false;
          try {
            samePage = new URL(item.href, window.location.origin).pathname === pathname;
          } catch {}
          if (!samePage) continue;
          const t = tabOf(item.href, pathname) ?? (item.type ? TAB_BY_PENDING_TYPE[item.type] : undefined);
          if (t) s.add(t);
        }
        setPendingTabs(s);
      })
      .catch(() => {});
    fetch("/api/notifications")
      .then((r) => (r.ok ? r.json() : null))
      .then((rows: NotificationRow[] | null) => {
        const s = new Set<string>();
        for (const n of rows ?? []) {
          if (n.readAt) continue;
          const t = tabOf(n.url, pathname);
          if (t) s.add(t);
        }
        const current = currentTabRef.current;
        if (s.has(current)) {
          s.delete(current);
          fetch("/api/notifications/read", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: pathname, tab: current }),
          }).catch(() => {});
        }
        setNotifTabs(s);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    // Carga inicial diferida (patrón del repo para fetch-on-mount) y de nuevo
    // cada vez que la persona vuelve a la app, así el punto se actualiza sin
    // recargar la página.
    const t = setTimeout(load, 0);
    function onVisible() {
      if (document.visibilityState === "visible") load();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const markTabSeen = useCallback(
    (tab: string) => {
      if (!notifTabs.has(tab)) return;
      setNotifTabs((prev) => {
        const next = new Set(prev);
        next.delete(tab);
        return next;
      });
      fetch("/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: window.location.pathname, tab }),
      }).catch(() => {});
    },
    [notifTabs]
  );

  const hasDot = useCallback((tab: string) => pendingTabs.has(tab) || notifTabs.has(tab), [pendingTabs, notifTabs]);

  return { hasDot, markTabSeen };
}
