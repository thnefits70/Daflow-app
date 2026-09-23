"use client";

import { useEffect } from "react";

// Se abre el diálogo de impresión solo al cargar (Daniel ya pidió imprimir);
// el botón queda por si lo cerró o quiere guardarlo como PDF.
export function PrintButton() {
  useEffect(() => {
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, []);
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="print:hidden fixed top-4 right-4 text-[13px] font-bold bg-blue text-white rounded-md px-4 py-2 cursor-pointer shadow"
    >
      Imprimir / Descargar PDF
    </button>
  );
}
