"use client";

import { useState } from "react";
import { FileText, Download, ChevronDown, ChevronUp } from "lucide-react";

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
  const [expanded, setExpanded] = useState(false);
  const isPdf = isPdfUrl(url);
  const name = filename ?? (isPdf ? "comprobante.pdf" : "comprobante.jpg");

  async function handleDownload(e: React.MouseEvent) {
    e.preventDefault();
    setDownloading(true);
    await downloadFile(url, name);
    setDownloading(false);
  }

  return (
    <div className={isPdf ? "w-full" : undefined}>
      <div className="flex items-center gap-2.5">
        {isPdf ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="rounded border border-rule bg-cloud flex items-center justify-center shrink-0 cursor-pointer"
            style={{ width: size, height: size }}
            title={expanded ? "Ocultar documento" : "Ver documento aquí mismo"}
          >
            <FileText size={size * 0.4} className="text-steel" />
          </button>
        ) : (
          <a href={url} target="_blank" rel="noopener noreferrer" title="Clic derecho para copiar la imagen · clic para verla completa">
            <img
              src={url}
              alt="Comprobante"
              className="rounded object-cover border border-rule cursor-pointer"
              style={{ width: size, height: size }}
            />
          </a>
        )}
        <button type="button" disabled={downloading} className="flex items-center gap-1 text-[11px] text-blue font-semibold cursor-pointer disabled:opacity-60" onClick={handleDownload}>
          <Download size={12} /> {downloading ? "Descargando…" : "Descargar"}
        </button>
        {isPdf && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-[11px] text-steel font-semibold cursor-pointer"
          >
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />} {expanded ? "Ocultar" : "Ver documento"}
          </button>
        )}
      </div>
      {isPdf && expanded && (
        <iframe src={url} title={name} className="w-full rounded border border-rule mt-2" style={{ height: 480 }} />
      )}
    </div>
  );
}
