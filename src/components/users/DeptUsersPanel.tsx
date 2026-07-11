"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Pencil, KeyRound, User } from "lucide-react";
import { PositionPicker } from "./PositionPicker";

type DeptUser = { id: string; name: string; username: string; position: string | null };
type Position = { id: string; name: string };

export function DeptUsersPanel({
  deptId,
  users,
  positions,
}: {
  deptId: string;
  users: DeptUser[];
  positions: Position[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [position, setPosition] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editUsername, setEditUsername] = useState("");
  const [editPosition, setEditPosition] = useState("");

  const [resettingId, setResettingId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");

  const [showCatalog, setShowCatalog] = useState(false);
  const removePosition = async (id: string) => {
    setBusy(true);
    await fetch(`/api/positions/${id}`, { method: "DELETE" });
    setBusy(false);
    router.refresh();
  };

  const create = async () => {
    if (!name.trim() || !username.trim() || !password.trim()) {
      setErr("Completa nombre, usuario y contraseña.");
      return;
    }
    setErr("");
    setBusy(true);
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), username: username.trim(), password: password.trim(), position: position.trim(), deptId }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setErr(data?.error ?? "No se pudo crear el acceso.");
      return;
    }
    setName("");
    setUsername("");
    setPassword("");
    setPosition("");
    router.refresh();
  };

  const startEdit = (u: DeptUser) => {
    setEditingId(u.id);
    setEditName(u.name);
    setEditUsername(u.username);
    setEditPosition(u.position ?? "");
  };

  const saveEdit = async (id: string) => {
    setBusy(true);
    await fetch(`/api/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName.trim(), username: editUsername.trim(), position: editPosition.trim() }),
    });
    setBusy(false);
    setEditingId(null);
    router.refresh();
  };

  const saveNewPassword = async (id: string) => {
    if (!newPassword.trim()) return;
    setBusy(true);
    await fetch(`/api/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: newPassword.trim() }),
    });
    setBusy(false);
    setResettingId(null);
    setNewPassword("");
    router.refresh();
  };

  const remove = async (id: string) => {
    setBusy(true);
    await fetch(`/api/users/${id}`, { method: "DELETE" });
    setBusy(false);
    router.refresh();
  };

  return (
    <div>
      <div className="bg-white border border-rule rounded p-4.5 mb-5">
        <label className="block mb-3 text-[11px] font-semibold tracking-wide uppercase text-steel">
          Añadir persona a esta área
        </label>
        <div className="grid grid-cols-4 gap-3 mb-2.5">
          <input
            className="rounded border border-rule px-2.5 py-2 text-[13.5px]"
            placeholder="Nombre (ej. Ana Pérez)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="rounded border border-rule px-2.5 py-2 text-[13.5px]"
            placeholder="Usuario (ej. ana.perez)"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <input
            className="rounded border border-rule px-2.5 py-2 text-[13.5px]"
            placeholder="Contraseña"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <PositionPicker
            deptId={deptId}
            positions={positions}
            value={position}
            onChange={setPosition}
            onPositionCreated={() => router.refresh()}
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded border border-navy bg-navy px-4 py-2 text-[13px] font-semibold text-white cursor-pointer disabled:opacity-60"
            onClick={create}
          >
            <Plus size={14} /> Crear acceso
          </button>
          <button
            type="button"
            className="text-[12px] text-steel hover:text-navy cursor-pointer underline underline-offset-2"
            onClick={() => setShowCatalog((v) => !v)}
          >
            {showCatalog ? "Ocultar" : "Ver / administrar"} catálogo de puestos ({positions.length})
          </button>
        </div>
        {err && <div className="text-red text-[12.5px] mt-2">{err}</div>}

        {showCatalog && (
          <div className="mt-3.5 pt-3.5 border-t border-rule">
            {positions.length === 0 && (
              <div className="text-steel text-[12.5px]">
                Aún no hay puestos creados. Usa &quot;+ Agregar nuevo puesto…&quot; en el selector de cargo.
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {positions.map((p) => (
                <span
                  key={p.id}
                  className="inline-flex items-center gap-1.5 text-[12px] bg-cloud border border-rule rounded-full px-3 py-1"
                >
                  {p.name}
                  <button
                    type="button"
                    className="text-steel hover:text-red cursor-pointer"
                    onClick={() => removePosition(p.id)}
                  >
                    <Trash2 size={11} />
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {users.length === 0 && (
        <div className="border-[1.5px] border-dashed border-rule rounded-md p-8.5 text-center text-steel text-[13.5px]">
          Aún no hay personas registradas en esta área.
        </div>
      )}

      {users.map((u) => (
        <div key={u.id} className="bg-white border border-rule rounded p-4 mb-2.5">
          {editingId === u.id ? (
            <div className="flex items-center gap-2.5">
              <input className="flex-1 rounded border border-rule px-2 py-1.5 text-[13px]" value={editName} onChange={(e) => setEditName(e.target.value)} />
              <input className="flex-1 rounded border border-rule px-2 py-1.5 text-[13px]" value={editUsername} onChange={(e) => setEditUsername(e.target.value)} />
              <PositionPicker
                deptId={deptId}
                positions={positions}
                value={editPosition}
                onChange={setEditPosition}
                onPositionCreated={() => router.refresh()}
              />
              <button type="button" disabled={busy} className="rounded border border-navy bg-navy px-3 py-1.5 text-[12.5px] font-semibold text-white cursor-pointer" onClick={() => saveEdit(u.id)}>
                Guardar
              </button>
              <button type="button" className="text-steel text-[12.5px] cursor-pointer" onClick={() => setEditingId(null)}>
                Cancelar
              </button>
            </div>
          ) : resettingId === u.id ? (
            <div className="flex items-center gap-2.5">
              <span className="text-[13px] text-steel shrink-0">Nueva contraseña para {u.name}:</span>
              <input
                className="flex-1 rounded border border-rule px-2 py-1.5 text-[13px]"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Mínimo 4 caracteres"
              />
              <button type="button" disabled={busy} className="rounded border border-navy bg-navy px-3 py-1.5 text-[12.5px] font-semibold text-white cursor-pointer" onClick={() => saveNewPassword(u.id)}>
                Guardar
              </button>
              <button type="button" className="text-steel text-[12.5px] cursor-pointer" onClick={() => { setResettingId(null); setNewPassword(""); }}>
                Cancelar
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <User size={16} className="text-steel shrink-0" />
                <div>
                  <div className="font-semibold text-[13.5px]">{u.name}</div>
                  <div className="text-[12px] text-steel mt-0.5">
                    <span className="font-mono">{u.username}</span>
                    {u.position && <span> · {u.position}</span>}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <button type="button" className="text-steel hover:text-navy cursor-pointer" title="Restablecer contraseña" onClick={() => setResettingId(u.id)}>
                  <KeyRound size={15} />
                </button>
                <button type="button" className="text-steel hover:text-navy cursor-pointer" title="Editar" onClick={() => startEdit(u)}>
                  <Pencil size={15} />
                </button>
                <button type="button" className="text-steel hover:text-red cursor-pointer" title="Eliminar" onClick={() => remove(u.id)}>
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
