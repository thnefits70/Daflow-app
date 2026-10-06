"use client";

import { CatalogCode } from "@/components/shared/CatalogCode";

// Pedido del usuario 2026-10-05 (caso Nairoby): matriculó ROL-SUM-013
// "ROLLO ETIQUETA TÉRMICA" con las fotos y la descripción de PLA-SUM-009
// "PLÁSTICO FILM" por tocar el producto equivocado de la lista. Antes de
// guardar fotos se pregunta en grande a qué producto van, para que el error
// se note antes y no después.
export function ConfirmPhotosBelongTo({
  item,
  photos,
  saving,
  onConfirm,
  onBack,
  onWrongProduct,
}: {
  item: { name: string; justCode?: string | null };
  photos: string[];
  saving: boolean;
  onConfirm: () => void;
  onBack: () => void;
  onWrongProduct: () => void;
}) {
  return (
    <div className="border border-gold/50 rounded-md bg-gold/5 p-3">
      <div className="text-[12.5px] text-ink mb-2">¿Estas fotos son de este producto?</div>
      <div className="flex items-center gap-1.5 text-[14px] font-bold mb-2.5">
        <CatalogCode code={item.justCode} />
        <span>{item.name}</span>
      </div>
      <div className="flex gap-2 mb-3">
        {photos.map((p, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img loading="lazy" decoding="async" key={i} src={p} alt="" className="w-16 h-16 rounded object-cover border border-rule" />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={saving}
          className="rounded border border-teal bg-teal px-3 py-1.5 text-[12px] font-bold text-navy cursor-pointer disabled:opacity-60"
          onClick={onConfirm}
        >
          {saving ? "Guardando…" : "Sí, son de este producto"}
        </button>
        <button type="button" disabled={saving} className="rounded border border-red/50 px-3 py-1.5 text-[12px] font-semibold text-red cursor-pointer" onClick={onWrongProduct}>
          No, me equivoqué de producto
        </button>
        <button type="button" disabled={saving} className="text-steel text-[12px] cursor-pointer" onClick={onBack}>
          Volver
        </button>
      </div>
    </div>
  );
}
