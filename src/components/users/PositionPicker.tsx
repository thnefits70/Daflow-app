"use client";

import { useState } from "react";

type Position = { id: string; name: string };

const NEW_OPTION = "__new__";

export function PositionPicker({
  deptId,
  positions,
  value,
  onChange,
  onPositionCreated,
}: {
  deptId: string;
  positions: Position[];
  value: string;
  onChange: (value: string) => void;
  onPositionCreated: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const create = async () => {
    if (!newName.trim()) return;
    setErr("");
    setBusy(true);
    const res = await fetch(`/api/departments/${deptId}/positions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim() }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setErr(data?.error ?? "No se pudo crear el puesto.");
      return;
    }
    onChange(newName.trim());
    setNewName("");
    setCreating(false);
    onPositionCreated();
  };

  if (creating) {
    return (
      <div className="flex items-center gap-1.5">
        <input
          autoFocus
          className="flex-1 rounded border border-rule px-2.5 py-2 text-[13.5px]"
          placeholder="Nombre del nuevo puesto"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
        />
        <button
          type="button"
          disabled={busy}
          className="rounded border border-navy bg-navy px-2.5 py-2 text-[12px] font-semibold text-white cursor-pointer shrink-0"
          onClick={create}
        >
          Guardar
        </button>
        <button
          type="button"
          className="text-steel text-[12px] cursor-pointer shrink-0"
          onClick={() => {
            setCreating(false);
            setErr("");
          }}
        >
          Cancelar
        </button>
        {err && <div className="text-red text-[11.5px] absolute mt-9">{err}</div>}
      </div>
    );
  }

  return (
    <select
      className="rounded border border-rule px-2.5 py-2 text-[13.5px] bg-white"
      value={value}
      onChange={(e) => {
        if (e.target.value === NEW_OPTION) {
          setCreating(true);
          return;
        }
        onChange(e.target.value);
      }}
    >
      <option value="">Cargo (opcional)</option>
      {positions.map((p) => (
        <option key={p.id} value={p.name}>
          {p.name}
        </option>
      ))}
      <option value={NEW_OPTION}>+ Agregar nuevo puesto…</option>
    </select>
  );
}
