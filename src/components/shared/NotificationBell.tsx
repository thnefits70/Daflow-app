"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bell } from "lucide-react";

type Notification = { id: string; title: string; body: string; url: string | null; createdAt: string; readAt: string | null };

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `hace ${hr} h`;
  const days = Math.floor(hr / 24);
  return `hace ${days} d`;
}

// Confirmado 2026-08-18: pedido explícito del usuario — puramente
// informativa, no reemplaza "Pendientes" (que sigue igual). Un clic
// despliega de más reciente a más antigua; otro clic (o afuera) la cierra.
// Disponible para todo el equipo, cada quien ve solo lo suyo.
//
// Confirmado 2026-08-19: el menú lateral tiene overflow-hidden. Un simple
// `position: fixed` no alcanza — el recorte por overflow pasa por dónde
// vive el elemento en el HTML, no por cómo se posiciona. Se saca el panel
// del todo del árbol del sidebar con un portal a document.body.
export function NotificationBell() {
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [panelPos, setPanelPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  function load() {
    fetch("/api/notifications").then((r) => (r.ok ? r.json() : [])).then(setItems);
  }
  useEffect(() => {
    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (ref.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (rect) {
        const panelWidth = 288; // w-72
        const left = Math.min(Math.max(8, rect.left), window.innerWidth - panelWidth - 8);
        setPanelPos({ top: rect.bottom + 8, left });
      }
      const hadUnread = items.some((n) => !n.readAt);
      if (hadUnread) {
        await fetch("/api/notifications/read", { method: "POST" });
        load();
      }
    }
  }

  const unreadCount = items.filter((n) => !n.readAt).length;

  return (
    <div className="relative" ref={ref}>
      <button ref={buttonRef} type="button" onClick={toggle} className="relative flex items-center justify-center w-8 h-8 rounded-md text-[#C9CFC5] hover:text-white hover:bg-white/[.06] cursor-pointer" aria-label="Notificaciones">
        <Bell size={16} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-red text-white text-[9px] font-bold rounded-full min-w-[15px] h-[15px] flex items-center justify-center px-1">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open &&
        panelPos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            style={{ position: "fixed", top: panelPos.top, left: panelPos.left }}
            className="w-72 max-h-96 overflow-y-auto bg-[#0c1524] border border-white/10 rounded-md shadow-lg z-[9999]"
          >
            <div className="text-[10px] font-semibold uppercase tracking-wide text-[#8C99A6] px-3 py-2 border-b border-white/10">Notificaciones</div>
            {items.length === 0 ? (
              <div className="text-[12px] text-[#8C99A6] px-3 py-4 text-center">No hay notificaciones todavía.</div>
            ) : (
              items.map((n) => (
                <a
                  key={n.id}
                  href={n.url ?? "#"}
                  className="block px-3 py-2.5 border-b border-white/5 last:border-0 hover:bg-white/[.04]"
                >
                  <div className="text-[12.5px] font-semibold text-white">{n.title}</div>
                  <div className="text-[11.5px] text-[#C9CFC5] mt-0.5 leading-snug">{n.body}</div>
                  <div className="text-[10px] text-[#8C99A6] mt-1">{relativeTime(n.createdAt)}</div>
                </a>
              ))
            )}
          </div>,
          document.body
        )}
    </div>
  );
}
