"use client";

import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Upload, CheckCircle2, Lock, Plus, AlertTriangle } from "lucide-react";
import { uploadFile } from "@/lib/uploadFile";
import { compressImage } from "@/lib/compressImage";
import { usePasteFile } from "@/lib/usePasteFile";

// Confirmado 2026-10-06, caso SC-159 (HIDAFLEX): se transfirió $1,279.25 en
// vez de $1,279.95 por un error al escribir el monto, y la solicitud quedó
// trabada porque solo aceptaba UN comprobante. Ahora se pueden subir varias
// transferencias para la misma solicitud: la IA lee el monto de cada una y
// se puede confirmar solo si la SUMA da exactamente lo que corresponde pagar.
export type ProofEntry = {
  key: string;
  url: string | null;
  verifying: boolean;
  readAmount: number | null;
  receiptNumber: string | null;
  read: boolean;
};

export const MAX_PAYMENT_PROOFS = 5;

export function proofsTotal(proofs: ProofEntry[]) {
  return proofs.reduce((s, p) => s + (p.readAmount ?? 0), 0);
}

// Mismo N° de comprobante leído en dos fotos = la misma transferencia subida
// dos veces; nunca debe contar doble para completar el total.
export function repeatedReceiptNumber(proofs: ProofEntry[]) {
  const seen = new Set<string>();
  for (const p of proofs) {
    const n = p.receiptNumber?.trim();
    if (!n) continue;
    if (seen.has(n)) return n;
    seen.add(n);
  }
  return null;
}

export function proofsMatch(proofs: ProofEntry[], expected: number) {
  if (proofs.length === 0) return false;
  if (proofs.some((p) => !p.url || p.verifying || !p.read || p.readAmount === null)) return false;
  if (repeatedReceiptNumber(proofs)) return false;
  return Math.abs(proofsTotal(proofs) - expected) < 0.01;
}

export function proofsBusy(proofs: ProofEntry[]) {
  return proofs.some((p) => !p.url || p.verifying);
}

// Lo que se manda a las rutas de pago: el primero va en los campos de
// siempre (paymentProofUrl / receiptNumber), el resto como extraProofs.
export function proofsPayload(proofs: ProofEntry[]) {
  const done = proofs.filter((p) => p.url);
  const [first, ...rest] = done;
  return {
    first: first ? { url: first.url!, receiptNumber: first.receiptNumber } : null,
    extra: rest.map((p) => ({ url: p.url!, receiptNumber: p.receiptNumber })),
  };
}

function money(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function PaymentProofList({
  proofs,
  setProofs,
  expectedAmount,
  optional = false,
  onError,
}: {
  proofs: ProofEntry[];
  setProofs: Dispatch<SetStateAction<ProofEntry[]>>;
  expectedAmount: number;
  optional?: boolean;
  onError: (message: string) => void;
}) {
  const [addingMore, setAddingMore] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { onPaste, onMouseEnter, onMouseLeave } = usePasteFile((file) => upload(file));

  function patch(key: string, data: Partial<ProofEntry>) {
    setProofs((list) => list.map((p) => (p.key === key ? { ...p, ...data } : p)));
  }

  async function upload(file: File) {
    if (proofs.length >= MAX_PAYMENT_PROOFS) return;
    onError("");
    const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setProofs((list) => [...list, { key, url: null, verifying: false, readAmount: null, receiptNumber: null, read: false }]);
    setAddingMore(false);
    const compressed = await compressImage(file);
    const uploaded = await uploadFile(compressed, "purchase-payments");
    if (!uploaded.ok) {
      setProofs((list) => list.filter((p) => p.key !== key));
      onError(uploaded.error);
      return;
    }
    patch(key, { url: uploaded.url, verifying: true });
    const res = await fetch("/api/purchase-requests/verify-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proofUrl: uploaded.url, expectedAmount: expectedAmount > 0 ? expectedAmount : 0.01 }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      patch(key, { verifying: false, read: true });
      onError(data?.error ?? "No se pudo verificar el comprobante.");
      return;
    }
    patch(key, { verifying: false, read: true, readAmount: data.readAmount ?? null, receiptNumber: data.receiptNumber ?? null });
  }

  function remove(key: string) {
    setProofs((list) => list.filter((p) => p.key !== key));
  }

  const total = proofsTotal(proofs);
  const busy = proofsBusy(proofs);
  const unreadable = proofs.some((p) => p.read && p.readAmount === null);
  const repeated = repeatedReceiptNumber(proofs);
  const matches = proofsMatch(proofs, expectedAmount);
  const missing = expectedAmount - total;
  const multiple = proofs.length > 1;
  const showDropZone = proofs.length === 0 || (addingMore && proofs.length < MAX_PAYMENT_PROOFS);

  return (
    <div className="mb-2">
      {proofs.length > 0 && (
        <div className="flex flex-col gap-1 mb-1.5">
          {proofs.map((p, i) => (
            <div key={p.key} className="flex items-center gap-2 text-[12px]">
              {!p.url || p.verifying ? (
                <span className="w-3.5 h-3.5 rounded-full border-2 border-rule border-t-teal animate-spin" />
              ) : p.readAmount === null ? (
                <Lock size={13} className="text-red" />
              ) : matches ? (
                <CheckCircle2 size={13} className="text-teal" />
              ) : (
                <CheckCircle2 size={13} className="text-steel" />
              )}
              <span className={p.read && p.readAmount === null ? "text-red" : "text-ink"}>
                {multiple ? `Comprobante ${i + 1}: ` : ""}
                {!p.url
                  ? "Subiendo…"
                  : p.verifying
                  ? "Verificando con IA…"
                  : p.readAmount !== null
                  ? `dice ${money(p.readAmount)}`
                  : "No se pudo leer el monto — sube una imagen más clara"}
              </span>
              {p.url && (
                <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-blue text-[11px] font-semibold">Ver</a>
              )}
              {p.url && !p.verifying && (
                <button type="button" className="text-steel text-[11px] cursor-pointer" onClick={() => remove(p.key)}>
                  {multiple ? "Quitar" : "Cambiar"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {proofs.length > 0 && !busy && (
        <div className="flex items-start gap-2 text-[12px] mb-1.5">
          {matches ? (
            <span className="text-teal flex items-center gap-1.5">
              <CheckCircle2 size={13} /> Verificado — {multiple ? `la suma coincide (${money(total)})` : `coincide (${money(total)})`}
            </span>
          ) : repeated ? (
            <span className="text-red flex items-center gap-1.5"><Lock size={13} /> Subiste dos veces la misma transferencia (N° {repeated}) — quita una.</span>
          ) : unreadable ? null : missing > 0.005 ? (
            <span className="text-red flex items-start gap-1.5">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>
                {multiple ? `Suman ${money(total)}` : `No coincide — dice ${money(total)}`}. Faltan <b>{money(missing)}</b> para llegar a {money(expectedAmount)}: transfiere la diferencia y súbela con &quot;Agregar otro comprobante&quot;.
              </span>
            </span>
          ) : (
            <span className="text-red flex items-start gap-1.5">
              <Lock size={13} className="mt-0.5 shrink-0" />
              <span>
                {multiple ? `Suman ${money(total)}` : `No coincide — dice ${money(total)}`}, más de lo que corresponde ({money(expectedAmount)}) — revisa antes de continuar.
              </span>
            </span>
          )}
        </div>
      )}

      {showDropZone ? (
        <div>
          <div
            tabIndex={0}
            onPaste={onPaste}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
            className="flex items-center gap-1.5 border-[1.5px] border-dashed border-rule rounded px-3 py-2 text-[12px] text-steel cursor-pointer hover:border-teal focus:border-teal focus:outline-none w-fit"
          >
            <Upload size={13} /> {proofs.length > 0 ? "Pega el otro comprobante aquí" : "Pega la foto aquí"} ({optional && proofs.length === 0 ? "opcional, " : ""}Ctrl+V)
            <button type="button" className="text-[10.5px] underline decoration-dotted opacity-80 hover:opacity-100 cursor-pointer" onClick={() => fileInputRef.current?.click()}>
              o selecciona un archivo
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(f); }} />
          </div>
          <div className="flex items-center gap-3 mt-1">
            <label className="flex items-center gap-1.5 text-[10.5px] text-steel cursor-pointer hover:text-teal w-fit">
              ¿Es un PDF? Subir documento
              <input type="file" accept="application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(f); }} />
            </label>
            {addingMore && (
              <button type="button" className="text-[10.5px] text-steel cursor-pointer" onClick={() => setAddingMore(false)}>Cancelar</button>
            )}
          </div>
        </div>
      ) : (
        !busy && !matches && proofs.length < MAX_PAYMENT_PROOFS && (
          <button
            type="button"
            className="flex items-center gap-1 text-[12px] font-semibold text-teal cursor-pointer hover:underline"
            onClick={() => setAddingMore(true)}
          >
            <Plus size={13} /> Agregar otro comprobante
          </button>
        )
      )}
    </div>
  );
}
