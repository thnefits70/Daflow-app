"use client";

import { useState } from "react";

// Pedido de Daniel (2026-09-22): en toda tabla con nombres de producto
// cortados (truncate + "..."), poder ver el nombre completo — tooltip
// nativo al pasar el mouse, y clic para expandirlo sin cortar.
export function ExpandableName({ text, className = "" }: { text: string; className?: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <span
      title={text}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setExpanded((v) => !v);
      }}
      className={`inline-block align-bottom cursor-pointer ${expanded ? "whitespace-normal break-words" : "truncate"} ${className}`}
    >
      {text}
    </span>
  );
}
