"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Trash2, Building2 } from "lucide-react";

type Department = { id: string; name: string; code: string };

export function ManageDepartments({ departments }: { departments: Department[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!name.trim()) {
      setErr("Escribe un nombre para el área.");
      return;
    }
    setErr("");
    setBusy(true);
    const res = await fetch("/api/departments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), code: (code || name.slice(0, 3)).toUpperCase() }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setErr(data?.error ?? "No se pudo crear el área.");
      return;
    }
    setName("");
    setCode("");
    router.refresh();
  };

  const remove = async (id: string) => {
    setBusy(true);
    await fetch(`/api/departments/${id}`, { method: "DELETE" });
    setBusy(false);
    router.refresh();
  };

  return (
    <div>
      <div className="bg-surface border border-rule rounded p-4.5 mb-5.5">
        <label className="block mb-3 text-[11px] font-semibold tracking-wide uppercase text-steel">
          Crear nueva área
        </label>
        <div className="grid grid-cols-2 gap-3 items-end">
          <input
            className="rounded border border-rule bg-surface px-2.5 py-2 text-[13.5px]"
            placeholder="Nombre del área (ej. Ventas)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="rounded border border-rule bg-surface px-2.5 py-2 text-[13.5px]"
            placeholder="Código corto (ej. VEN)"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </div>
        <button
          type="button"
          disabled={busy}
          className="mt-2.5 inline-flex items-center gap-1.5 rounded border border-blue bg-blue px-4 py-2 text-[13px] font-semibold text-white cursor-pointer disabled:opacity-60"
          onClick={add}
        >
          <Plus size={14} /> Crear área
        </button>
        {err && <div className="text-red text-[12.5px] mt-2">{err}</div>}
        <div className="text-[11.5px] text-steel mt-2.5">
          Después de crear el área, entra a su pestaña en el menú lateral para dar de alta a cada persona
          (esto se habilita en la siguiente fase).
        </div>
      </div>

      {departments.length === 0 && (
        <div className="border-[1.5px] border-dashed border-rule rounded-md p-8.5 text-center text-steel text-[13.5px]">
          Crea tu primera área para empezar a documentar procesos.
        </div>
      )}

      {departments.map((d) => (
        <div key={d.id} className="bg-surface border border-rule rounded p-4.5 mb-3 flex items-center justify-between gap-3">
          <Link href={`/admin/dept/${d.id}`} className="font-semibold flex items-center gap-1.5 hover:underline">
            <Building2 size={14} /> {d.name}
            <span className="font-mono text-[10px] font-normal bg-cloud border border-rule rounded-full px-2 py-0.5 uppercase text-steel ml-1">
              {d.code}
            </span>
          </Link>
          <button
            type="button"
            disabled={busy}
            className="text-steel hover:text-red cursor-pointer disabled:opacity-60"
            onClick={() => remove(d.id)}
          >
            <Trash2 size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
