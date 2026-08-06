"use client";

import { useState } from "react";
import { FileText, Receipt, Truck, ClipboardCheck, Camera, AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { actorName } from "@/lib/actorName";

export type OperationDocRow = {
  id: string;
  catalogItem: { name: string; photos: string[] };
  quoteImageUrl: string;
  purchaseOrderUrl: string | null;
  paymentProofUrl: string | null;
  shippingPaymentProofUrl: string | null;
  invoiceDocUrl: string | null;
  requestedBy: { name: string } | null;
  paidBy: { name: string } | null;
  invoicedBy: { name: string } | null;
  receipt: {
    photoUrls: string[];
    receivedQuantity: number;
    aiPhotoMatch: boolean | null;
    aiPhotoNote: string | null;
    confirmedBy: { name: string } | null;
  } | null;
};

function isPdf(url: string) {
  return /\.pdf($|\?)/i.test(url);
}

function DocThumb({ url }: { url: string }) {
  return isPdf(url) ? (
    <div className="w-11 h-11 rounded border border-rule bg-cloud flex items-center justify-center shrink-0">
      <FileText size={18} className="text-steel" />
    </div>
  ) : (
    <img src={url} alt="" className="w-11 h-11 rounded object-cover border border-rule shrink-0" />
  );
}

function DocRow({ icon, label, url, meta, missingNote }: { icon: React.ReactNode; label: string; url: string | null; meta?: string; missingNote?: string }) {
  if (!url) {
    if (!missingNote) return null;
    return (
      <div className="flex items-center gap-3 py-2">
        <div className="w-11 h-11 rounded border border-dashed border-gold/40 flex items-center justify-center shrink-0" style={{ color: "#D9A441" }}>
          {icon}
        </div>
        <div className="flex-1 text-[12px]" style={{ color: "#D9A441" }}>
          <div className="font-semibold">{label}</div>
          <div className="flex items-center gap-1"><AlertTriangle size={11} /> {missingNote}</div>
        </div>
      </div>
    );
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 py-2 hover:opacity-80">
      <DocThumb url={url} />
      <div className="flex-1 text-[12px]">
        <div className="font-semibold text-ink">{label}</div>
        {meta && <div className="text-steel">{meta}</div>}
      </div>
      <span className="text-[11px] font-semibold text-blue shrink-0">Ver</span>
    </a>
  );
}

// Confirmado 2026-08-06: vista consolidada de TODO lo que se ha subido en la
// operación (cotización, orden de compra, comprobantes de pago, factura, y
// las fotos de recepción por producto), con quién subió cada cosa y a qué
// paso corresponde — para revisar los respaldos completos desde Inventario
// (Daniel) o desde Finanzas (Nairoby, al registrar factura) sin tener que
// saltar entre pantallas. Los documentos compartidos (cotización, orden de
// compra, pagos, factura) son los mismos en todas las filas del grupo — se
// toman de la primera; la recepción sí es por producto.
export function PurchaseOperationDocuments({ rows }: { rows: OperationDocRow[] }) {
  const [open, setOpen] = useState(false);
  const r0 = rows[0];
  if (!r0) return null;

  if (!open) {
    return (
      <button
        type="button"
        className="flex items-center gap-1.5 text-[11.5px] font-semibold text-steel hover:text-ink cursor-pointer"
        onClick={() => setOpen(true)}
      >
        <ChevronRight size={13} /> Ver documentos de la operación
      </button>
    );
  }

  return (
    <div className="bg-cloud border border-rule rounded-md p-3.5">
      <button
        type="button"
        className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-steel mb-1 cursor-pointer hover:text-ink"
        onClick={() => setOpen(false)}
      >
        <ChevronDown size={13} /> Documentos de la operación
      </button>
      <div className="divide-y divide-rule/60">
        <DocRow
          icon={<Receipt size={16} />}
          label="Cotización"
          url={r0.quoteImageUrl}
          meta={`Solicitada por ${actorName(r0.requestedBy?.name)}`}
        />
        <DocRow
          icon={<ClipboardCheck size={16} />}
          label="Orden de compra"
          url={r0.purchaseOrderUrl}
          meta={`Subida por ${actorName(r0.requestedBy?.name)}`}
          missingNote="Todavía no se ha subido"
        />
        <DocRow
          icon={<Receipt size={16} />}
          label="Comprobante de pago — mercadería"
          url={r0.paymentProofUrl}
          meta={r0.paidBy ? `Pagado por ${actorName(r0.paidBy.name)}` : undefined}
        />
        {r0.shippingPaymentProofUrl && (
          <DocRow icon={<Truck size={16} />} label="Comprobante de pago — flete" url={r0.shippingPaymentProofUrl} />
        )}
        <DocRow
          icon={<FileText size={16} />}
          label="Factura"
          url={r0.invoiceDocUrl}
          meta={r0.invoicedBy ? `Registrada por ${actorName(r0.invoicedBy.name)}` : undefined}
        />
      </div>

      <div className="text-[10.5px] font-semibold uppercase tracking-wide text-steel mt-3 mb-1.5">Fotos de recepción por producto</div>
      <div className="flex flex-col gap-2.5">
        {rows.map((r) => (
          <div key={r.id} className="text-[12px]">
            <div className="font-semibold text-ink mb-1">{r.catalogItem.name}</div>
            {r.receipt ? (
              <div>
                <div className="flex flex-wrap gap-1.5 mb-1">
                  {r.receipt.photoUrls.map((u, i) => (
                    <a key={i} href={u} target="_blank" rel="noopener noreferrer">
                      <img src={u} alt="" className="w-16 h-16 rounded object-cover border border-rule" />
                    </a>
                  ))}
                </div>
                <div className="text-steel">
                  {r.receipt.receivedQuantity} un. recibidas · confirmado por {actorName(r.receipt.confirmedBy?.name)}
                </div>
                {r.receipt.aiPhotoNote && (
                  <div className={`flex items-center gap-1 mt-0.5 ${r.receipt.aiPhotoMatch ? "text-teal" : "text-steel"}`}>
                    🤖 {r.receipt.aiPhotoNote}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-steel">
                <Camera size={13} /> Pendiente de confirmar recepción
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
