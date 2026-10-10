"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RecalculateSnapshotButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/provedix/snapshot", { method: "POST" }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError("No se pudo recalcular. Vuelve a intentar en un momento.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex items-center gap-3">
      {error && <span className="text-[11.5px] text-red">{error}</span>}
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="rounded-md border border-rule bg-cloud px-3 py-1.5 text-[12px] font-semibold hover:bg-surface disabled:opacity-60 cursor-pointer"
      >
        {busy ? "Recalculando…" : "Recalcular ahora"}
      </button>
    </div>
  );
}
