"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, User, Award } from "lucide-react";

type Dept = { id: string; name: string; code: string };
type NominaUser = {
  id: string;
  name: string;
  username: string;
  position: string | null;
  photoUrl: string | null;
  deptId: string | null;
  department: Dept | null;
  isLeader: boolean;
  leadsDeptId: string | null;
};

export function NominaGrid({ users, departments }: { users: NominaUser[]; departments: Dept[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [deptId, setDeptId] = useState(departments[0]?.id ?? "");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!name.trim() || !username.trim() || !password.trim() || !deptId) {
      setErr("Completa nombre, usuario, contraseña y elige un área.");
      return;
    }
    setErr("");
    setBusy(true);
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), username: username.trim(), password: password.trim(), deptId }),
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
    router.refresh();
  };

  const deptById = (id: string | null) => departments.find((d) => d.id === id);

  return (
    <div>
      <div className="text-[13px] text-steel mb-4.5 max-w-2xl">
        Aquí se crea y gestiona a cada persona: acceso a la plataforma, área asignada, foto, datos de contacto, CV,
        habilidades e historial de avance. El área que le asignes es la que determina a qué información puede
        entrar.
      </div>

      <div className="bg-surface border border-rule rounded p-4.5 mb-6">
        <label className="block mb-3 text-[11px] font-semibold tracking-wide uppercase text-steel">
          Añadir persona directamente
        </label>
        <div className="grid grid-cols-4 gap-3 mb-3">
          <input className="rounded border border-rule px-2.5 py-2 text-[13.5px]" placeholder="Nombre (ej. Ana Pérez)" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="rounded border border-rule px-2.5 py-2 text-[13.5px]" placeholder="Usuario (ej. ana.perez)" value={username} onChange={(e) => setUsername(e.target.value)} />
          <input className="rounded border border-rule px-2.5 py-2 text-[13.5px]" placeholder="Contraseña" value={password} onChange={(e) => setPassword(e.target.value)} />
          <select className="rounded border border-rule px-2.5 py-2 text-[13.5px] bg-surface" value={deptId} onChange={(e) => setDeptId(e.target.value)}>
            {departments.length === 0 && <option value="">Crea un área primero</option>}
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
        <button
          type="button"
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded border border-blue bg-blue px-4 py-2 text-[13px] font-semibold text-white cursor-pointer disabled:opacity-60"
          onClick={create}
        >
          <Plus size={14} /> Crear acceso
        </button>
        {err && <div className="text-red text-[12.5px] mt-2">{err}</div>}
      </div>

      {users.length === 0 && (
        <div className="border-[1.5px] border-dashed border-rule rounded-md p-8.5 text-center text-steel text-[13.5px]">
          Aún no hay personas registradas.
        </div>
      )}

      <div className="grid grid-cols-4 gap-3">
        {users.map((u) => (
          <Link
            key={u.id}
            href={`/admin/nomina/${u.id}`}
            className="bg-surface border border-rule rounded p-4.5 text-center hover:border-blue"
          >
            <div className="w-14 h-14 rounded-full overflow-hidden bg-cloud border border-rule flex items-center justify-center mx-auto mb-2.5">
              {u.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={u.photoUrl} alt={u.name} className="w-full h-full object-cover" />
              ) : (
                <User size={22} className="text-steel" />
              )}
            </div>
            <div className="font-semibold text-[13.5px]">{u.name}</div>
            <div className="text-[11.5px] text-steel mt-0.5">{u.position || deptById(u.deptId)?.name || "Sin área"}</div>
            {u.isLeader && u.leadsDeptId && (
              <div className="inline-flex items-center gap-1 font-mono text-[9.5px] bg-cloud border border-rule rounded-full px-2 py-0.5 mt-1.5">
                <Award size={9} /> Líder de {deptById(u.leadsDeptId)?.name || "área"}
              </div>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
