"use client";

import { useEffect, useState } from "react";

// Doble clic sobre cualquier imagen pequeña de la app la amplía, sin tener
// que cablear esto módulo por módulo. Se ignoran imágenes que ya traen su
// propio zoom manual (clase cursor-zoom-in, patrón usado en Caja Chica,
// Compras Personales, etc.), imágenes dentro de un <a> (ya tienen su propio
// comportamiento de clic, ej. ProofPreview abre el original en pestaña
// nueva) y las que ya son grandes (no son "miniaturas").
const MAX_ZOOMABLE_SIZE = 240;

export function GlobalImageZoom() {
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);

  useEffect(() => {
    function onDoubleClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      const img = target?.closest("img") as HTMLImageElement | null;
      if (!img) return;
      if (img.closest("a")) return;
      if (img.classList.contains("cursor-zoom-in")) return;
      if (img.dataset.noZoom !== undefined) return;
      const rect = img.getBoundingClientRect();
      if (rect.width > MAX_ZOOMABLE_SIZE || rect.height > MAX_ZOOMABLE_SIZE) return;
      const url = img.currentSrc || img.src;
      if (!url) return;
      setZoomUrl(url);
    }

    document.addEventListener("dblclick", onDoubleClick);
    return () => document.removeEventListener("dblclick", onDoubleClick);
  }, []);

  useEffect(() => {
    if (!zoomUrl) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setZoomUrl(null);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [zoomUrl]);

  if (!zoomUrl) return null;

  return (
    <div
      className="fixed inset-0 z-[999] bg-black/80 flex items-center justify-center p-6 cursor-zoom-out"
      onClick={() => setZoomUrl(null)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={zoomUrl}
        alt="Imagen ampliada"
        className="max-w-full max-h-full rounded-md shadow-lg"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}
