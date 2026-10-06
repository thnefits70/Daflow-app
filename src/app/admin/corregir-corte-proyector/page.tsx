"use client";

import { useState } from "react";

// UN SOLO USO — ver src/app/api/admin/corregir-corte-proyector/route.ts.
export default function CorregirCorteProyectorPage() {
  const [state, setState] = useState<{ busy: boolean; msg: string | null; ok: boolean }>({ busy: false, msg: null, ok: false });

  async function run() {
    setState({ busy: true, msg: null, ok: false });
    const res = await fetch("/api/admin/corregir-corte-proyector", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (res.ok) setState({ busy: false, ok: true, msg: `Listo. El corte quedó en 29 y se devolvió 1 Mini Proyector al stock${data.balanceAfter != null ? ` (stock ahora: ${data.balanceAfter})` : ""}.` });
    else setState({ busy: false, ok: false, msg: data.error ?? "No se pudo corregir." });
  }

  return (
    <div className="max-w-xl mx-auto p-6 flex flex-col gap-4">
      <h1 className="text-lg font-semibold">Corregir Corte 5 del 06-oct: Mini Proyector</h1>
      <p className="text-[13px]">
        El corte contó <b>30</b> Mini Proyector, pero las guías de ese corte traían <b>29</b>: la guía 189908172 ya salió el 05-oct. Daniel confirmó que esa unidad no salió de bodega.
      </p>
      <p className="text-[13px]">Al pulsar el botón: el corte queda en 29, se devuelve 1 Mini Proyector al stock y queda anotado en el corte.</p>
      <button
        type="button"
        disabled={state.busy || state.ok}
        onClick={run}
        className="self-start rounded bg-teal px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50 cursor-pointer"
      >
        {state.busy ? "Corrigiendo…" : "Corregir a 29 y devolver 1 al stock"}
      </button>
      {state.msg && <p className="text-[13px]" style={{ color: state.ok ? "var(--color-teal)" : "var(--color-red, #e5484d)" }}>{state.msg}</p>}
    </div>
  );
}
