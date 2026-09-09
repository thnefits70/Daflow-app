"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";

// Botón de copiar controlado desde afuera — para pantallas como
// JustCatalogPanel donde varias filas comparten un solo estado
// copiedCode/copyCode (solo una fila "flashea" el check a la vez).
export function CopyCodeButton({ code, copied, onCopy }: { code: string; copied: boolean; onCopy: (code: string) => void }) {
  return (
    <button
      type="button"
      title="Copiar código"
      className="text-steel hover:text-teal cursor-pointer shrink-0"
      onClick={(e) => {
        e.stopPropagation();
        onCopy(code);
      }}
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
    </button>
  );
}

// Botón para copiar cualquier valor (ej. número de cuenta, titular) al
// portapapeles con un solo clic, en celular o laptop. Muestra "Copiado" por
// 1.5s de confirmación. Usado en las pantallas de pago (compras, fletes).
export function CopyValueButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard no disponible, no hacer nada */
    }
  }

  return (
    <button
      type="button"
      title="Copiar"
      className={`flex items-center gap-1 shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold cursor-pointer border transition-colors ${
        copied ? "bg-teal text-white border-teal" : "bg-white text-teal border-teal/50 hover:bg-teal/10"
      }`}
      onClick={copy}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {copied ? "Copiado" : "Copiar"}
    </button>
  );
}

// Muestra el código de Just (justCode) de un producto vinculado al catálogo,
// con un botón para copiarlo — maneja su propio estado de "copiado" (flash
// de ~1.2s) para que quien lo use no tenga que cablear nada. Devuelve null
// si el producto no tiene código todavía (nullable) o si el nombre es texto
// libre sin vínculo al catálogo — en esos casos no hay ID que mostrar.
export function CatalogCode({ code, size = "text-[10.5px]" }: { code: string | null | undefined; size?: string }) {
  const [copied, setCopied] = useState(false);

  if (!code) return null;

  function copy(e: React.MouseEvent) {
    e.stopPropagation();
    navigator.clipboard.writeText(code as string).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  return (
    <>
      <span className={`font-mono ${size} text-teal shrink-0`}>{code}</span>
      <button type="button" title="Copiar código" className="text-steel hover:text-teal cursor-pointer shrink-0" onClick={copy}>
        {copied ? <Check size={11} /> : <Copy size={11} />}
      </button>
    </>
  );
}
