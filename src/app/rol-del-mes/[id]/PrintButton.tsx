"use client";

export function PrintButton() {
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
