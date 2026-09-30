"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { FileText, Download, Eye, X } from "lucide-react";

function isPdfUrl(url: string) {
  return /\.pdf($|\?)/i.test(url);
}

// Confirmado 2026-08-06: el admin reenvía comprobantes por WhatsApp al
// proveedor — necesita poder copiar la imagen con clic derecho (por eso el
// comprobante SIEMPRE se pinta como <img> real, nunca solo un link de texto)
// y descargarla con un clic. El atributo `download` de un <a> normal NO
// funciona en un archivo de otro origen (Supabase Storage) — el navegador
// simplemente lo abre en vez de descargarlo — así que la descarga real se
// hace bajando el archivo como blob y generando una URL local.
export async function downloadFile(url: string, filename: string) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
  } catch {
    window.open(url, "_blank");
  }
}

export function ProofPreview({ url, filename, size = 56 }: { url: string; filename?: string; size?: number }) {
  const [downloading, setDownloading] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const isPdf = isPdfUrl(url);
  const name = filename ?? (isPdf ? "comprobante.pdf" : "comprobante.jpg");

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFullscreen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  async function handleDownload(e: React.MouseEvent) {
    e.preventDefault();
    setDownloading(true);
    await downloadFile(url, name);
    setDownloading(false);
  }

  return (
    <div className="shrink-0">
      <div className="flex items-center gap-2.5">
        {isPdf ? (
          // Confirmado 2026-09-30, pedido de Nairoby: un clic abre el PDF en
          // una ventana emergente — ya no se despliega dentro de la tarjeta
          // ocupando espacio.
          <button
            type="button"
            onClick={() => setFullscreen(true)}
            className="rounded border border-rule bg-cloud flex items-center justify-center shrink-0 cursor-pointer"
            style={{ width: size, height: size }}
            title="Clic para ver el documento"
          >
            <FileText size={size * 0.4} className="text-steel" />
          </button>
        ) : (
          // shrink-0 + maxWidth "none": junto a un texto largo en celular, la
          // fila aplastaba la miniatura a lo ancho (se veía como una tira fina).
          <a href={url} target="_blank" rel="noopener noreferrer" className="shrink-0" title="Clic derecho para copiar la imagen · clic para verla completa">
            <img
              src={url}
              alt="Comprobante"
              className="rounded object-cover border border-rule cursor-pointer"
              style={{ width: size, height: size, maxWidth: "none" }}
            />
          </a>
        )}
        <button type="button" disabled={downloading} className="flex items-center gap-1 text-[11px] text-blue font-semibold cursor-pointer disabled:opacity-60" onClick={handleDownload}>
          <Download size={12} /> {downloading ? "Descargando…" : "Descargar"}
        </button>
        {isPdf && (
          <button
            type="button"
            onClick={() => setFullscreen(true)}
            className="flex items-center gap-1 text-[11px] text-steel font-semibold cursor-pointer"
          >
            <Eye size={12} /> Ver documento
          </button>
        )}
      </div>
      {isPdf && fullscreen && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[999] bg-black/80 flex flex-col p-3 sm:p-6" onClick={() => setFullscreen(false)}>
          <div className="flex justify-end mb-2">
            <button
              type="button"
              onClick={() => setFullscreen(false)}
              className="flex items-center gap-1 text-[12px] font-semibold text-white bg-white/10 hover:bg-white/20 rounded px-3 py-1.5 cursor-pointer"
            >
              <X size={14} /> Cerrar
            </button>
          </div>
          <iframe src={url} title={name} className="flex-1 w-full rounded bg-white" onClick={(e) => e.stopPropagation()} />
        </div>,
        document.body
      )}
    </div>
  );
}
