"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Trash2, Building2, ShieldAlert, RotateCcw, Trash } from "lucide-react";
import { formatDateTime } from "@/lib/formatDateTime";

type Department = { id: string; name: string; code: string };
type DeletedDepartment = Department & { deletedAt: string };

export function ManageDepartments({
  departments,
  deletedDepartments,
  adminTwoFactorEnabled,
}: {
  departments: Department[];
  deletedDepartments: DeletedDepartment[];
  adminTwoFactorEnabled: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<Department | null>(null);
  const [restoreBusyId, setRestoreBusyId] = useState<string | null>(null);

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

  const restore = async (id: string) => {
    setRestoreBusyId(id);
    await fetch(`/api/departments/${id}/restore`, { method: "POST" });
    setRestoreBusyId(null);
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
            className="text-steel hover:text-red cursor-pointer"
            onClick={() => setTarget(d)}
          >
            <Trash2 size={16} />
          </button>
        </div>
      ))}

      {deletedDepartments.length > 0 && (
        <div className="mt-7">
          <div className="flex items-center gap-1.5 mb-3 text-[11px] font-semibold tracking-wide uppercase text-steel">
            <Trash size={13} /> Papelera
          </div>
          {deletedDepartments.map((d) => (
            <div
              key={d.id}
              className="bg-cloud border border-rule rounded p-4.5 mb-3 flex items-center justify-between gap-3 opacity-80"
            >
              <div>
                <div className="font-semibold flex items-center gap-1.5">
                  <Building2 size={14} /> {d.name}
                  <span className="font-mono text-[10px] font-normal bg-surface border border-rule rounded-full px-2 py-0.5 uppercase text-steel ml-1">
                    {d.code}
                  </span>
                </div>
                <div className="text-[11.5px] text-steel mt-1">Eliminada el {formatDateTime(d.deletedAt)}</div>
              </div>
              <button
                type="button"
                disabled={restoreBusyId === d.id}
                className="inline-flex items-center gap-1.5 rounded border border-rule bg-surface px-3 py-1.5 text-[12.5px] font-semibold cursor-pointer disabled:opacity-60"
                onClick={() => restore(d.id)}
              >
                <RotateCcw size={13} /> Restaurar
              </button>
            </div>
          ))}
        </div>
      )}

      {target && (
        <DeleteDepartmentModal
          department={target}
          requiresCode={adminTwoFactorEnabled}
          onClose={() => setTarget(null)}
          onDeleted={() => {
            setTarget(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function DeleteDepartmentModal({
  department,
  requiresCode,
  onClose,
  onDeleted,
}: {
  department: Department;
  requiresCode: boolean;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [confirmName, setConfirmName] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const nameMatches = confirmName.trim() === department.name;

  const submit = async () => {
    if (!nameMatches) {
      setErr("El nombre no coincide.");
      return;
    }
    if (!password) {
      setErr("Escribe la contraseña de administrador.");
      return;
    }
    if (requiresCode && !code.trim()) {
      setErr("Escribe el código del autenticador o uno de respaldo.");
      return;
    }
    setErr("");
    setBusy(true);
    const res = await fetch(`/api/departments/${department.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmName: confirmName.trim(), password, code }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setErr(data?.error ?? "No se pudo eliminar el área.");
      return;
    }
    onDeleted();
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-6" onClick={onClose}>
      <div
        className="bg-surface border border-rule rounded-md p-5 max-w-[440px] w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-1.5 mb-1 text-[14px] font-bold text-red">
          <ShieldAlert size={16} /> Eliminar área
        </div>
        <div className="text-[12.5px] text-steel mb-4">
          Esta acción es delicada: {department.name} y todo lo que dependa de ella quedarán fuera de uso. Se puede
          restaurar después desde la papelera, pero requiere confirmar tu identidad.
        </div>

        <label className="block mb-1 text-[11px] font-semibold tracking-wide uppercase text-steel">
          Escribe el nombre exacto del área
        </label>
        <input
          className="w-full rounded border border-rule bg-surface px-2.5 py-2 text-[13.5px] mb-3"
          placeholder={department.name}
          value={confirmName}
          onChange={(e) => setConfirmName(e.target.value)}
        />

        <label className="block mb-1 text-[11px] font-semibold tracking-wide uppercase text-steel">
          Contraseña de administrador
        </label>
        <input
          type="password"
          className="w-full rounded border border-rule bg-surface px-2.5 py-2 text-[13.5px] mb-3"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {requiresCode && (
          <>
            <label className="block mb-1 text-[11px] font-semibold tracking-wide uppercase text-steel">
              Código del autenticador (o de respaldo)
            </label>
            <input
              className="w-full rounded border border-rule bg-surface px-2.5 py-2 text-[13.5px] mb-3 font-mono"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </>
        )}

        {err && <div className="text-red text-[12.5px] mb-3">{err}</div>}

        <div className="flex items-center justify-end gap-2 mt-1">
          <button
            type="button"
            className="rounded border border-rule bg-surface px-3.5 py-2 text-[13px] font-semibold cursor-pointer"
            onClick={onClose}
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={busy || !nameMatches}
            className="rounded border border-red bg-red px-3.5 py-2 text-[13px] font-semibold text-white cursor-pointer disabled:opacity-50"
            onClick={submit}
          >
            {busy ? "Eliminando..." : "Eliminar área"}
          </button>
        </div>
      </div>
    </div>
  );
}
