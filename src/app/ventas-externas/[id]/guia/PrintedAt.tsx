"use client";

import { useEffect, useState } from "react";

// Confirmado 2026-09-25, pedido de Yair: la guía impresa lleva la fecha,
// el día y la hora en que se imprimió. Se calcula en el navegador y se
// refresca justo antes de imprimir (evento beforeprint), para que si la
// página quedó abierta un rato la hora igual sea la de la impresión.
function nowLabel() {
  const parts = new Intl.DateTimeFormat("es-EC", {
    timeZone: "America/Guayaquil",
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = get("weekday");
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${get("day")}/${get("month")}/${get("year")} · ${get("hour")}:${get("minute")}`;
}

export function PrintedAt() {
  const [label, setLabel] = useState("");

  useEffect(() => {
    const update = () => setLabel(nowLabel());
    update();
    window.addEventListener("beforeprint", update);
    return () => window.removeEventListener("beforeprint", update);
  }, []);

  if (!label) return null;
  return (
    <div className="text-[11px] text-gray-500 mt-1 print:text-[1.8mm] print:mt-0">
      Impreso: {label}
    </div>
  );
}
