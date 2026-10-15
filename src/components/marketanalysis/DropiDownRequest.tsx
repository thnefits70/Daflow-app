"use client";

import { useState } from "react";
import { uploadFile } from "@/lib/uploadFile";
import type { HandoffItem } from "@/lib/handoffLocks";

// Pedido del usuario 2026-10-15 — ver handoffLocks.ts: si Dropi no funciona,
// la asesora B2B pide más tiempo para el ID madre con una captura del error.
// La 1.ª vez se dan 2 h laborables solas; después lo decide el admin.
export function DropiDownRequest({ item, onDone }: { item: HandoffItem; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  if (item.extensionPending) return <div className="text-gold text-[11.5px] mt-1.5">⏳ Pediste más tiempo al admin por Dropi: esperando su respuesta.</div>;
  if (msg) return <div className="text-teal text-[11.5px] mt-1.5">{msg}</div>;
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-[12px] text-steel hover:text-ink underline cursor-pointer mt-1.5">
        Dropi no funciona{item.autoExtensionUsed ? " — pedir más tiempo al admin" : ` — pedir 2 h más`}
      </button>
    );
  }

  async function send() {
    if (!file) return setErr("Sube la captura del error de Dropi.");
    if (!reason.trim()) return setErr("Escribe qué pasa con Dropi.");
    setBusy(true);
    setErr("");
    const up = await uploadFile(file, "dropi-down-proofs");
    if (!up.ok) {
      setBusy(false);
      return setErr(up.error);
    }
    const r = await fetch("/api/handoff-lock/extension", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposalId: item.proposalId, reason, photoUrl: up.url }),
    }).catch(() => null);
    const j = r ? await r.json().catch(() => null) : null;
    setBusy(false);
    if (!r || !r.ok) return setErr(j?.error ?? "No se pudo enviar. Vuelve a intentarlo.");
    setMsg(j?.message ?? "Enviado.");
    onDone();
  }

  return (
    <div className="mt-2 border border-rule rounded p-2.5 flex flex-col gap-2">
      <div className="text-[12px] text-steel">
        {item.autoExtensionUsed
          ? "Ya usaste tus 2 horas automáticas para este producto. Este pedido le llega al admin con tu captura."
          : "Sube una captura del error de Dropi y te damos 2 horas laborables más (solo una vez por producto)."}
      </div>
      <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-[12px]" />
      <textarea
        className="rounded border border-rule bg-surface px-2 py-1.5 text-[12.5px]"
        rows={2}
        placeholder="¿Qué pasa con Dropi? (ej.: no carga, da error al crear el producto)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <div className="flex items-center gap-2">
        <button type="button" disabled={busy} onClick={send} className="rounded bg-teal px-3 py-1.5 text-[12px] font-bold text-white cursor-pointer disabled:opacity-50">
          {busy ? "Enviando…" : item.autoExtensionUsed ? "Pedir más tiempo al admin" : "Pedir 2 horas más"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-[12px] text-steel cursor-pointer">
          Cancelar
        </button>
      </div>
      {err && <div className="text-red text-[12px]">{err}</div>}
    </div>
  );
}
