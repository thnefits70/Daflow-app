"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, FileText, ChevronRight, Trash2 } from "lucide-react";

type ProcessSummary = {
  id: string;
  title: string;
  description: string;
  stepCount: number;
  checklistCount: number;
};

export function ProcessListPanel({
  deptId,
  processes,
  editable,
  baseHref,
}: {
  deptId: string;
  processes: ProcessSummary[];
  editable: boolean;
  baseHref: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const createProcess = async () => {
    setBusy(true);
    const res = await fetch("/api/processes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deptId, title: "Nuevo proceso" }),
    });
    setBusy(false);
    if (!res.ok) return;
    const created = await res.json();
    router.push(`${baseHref}/${created.id}`);
  };

  const remove = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    await fetch(`/api/processes/${id}`, { method: "DELETE" });
    setBusy(false);
    router.refresh();
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="text-[13px] text-steel">
          Documentación paso a paso de cada proceso: flujograma y checklist.
        </div>
        {editable && (
          <button
            type="button"
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded border border-blue bg-blue px-3.5 py-2 text-[12.5px] font-semibold text-white cursor-pointer disabled:opacity-60"
            onClick={createProcess}
          >
            <Plus size={14} /> Nuevo proceso
          </button>
        )}
      </div>

      {processes.length === 0 && (
        <div className="border-[1.5px] border-dashed border-rule rounded-md p-8.5 text-center text-steel text-[13.5px]">
          {editable ? "Aún no has creado procesos para esta área." : "Todavía no hay procesos documentados."}
        </div>
      )}

      {processes.map((p) => (
        <Link
          key={p.id}
          href={`${baseHref}/${p.id}`}
          className="bg-surface border border-rule rounded p-4.5 mb-2.5 flex items-center justify-between gap-3 hover:border-blue"
        >
          <div>
            <div className="font-semibold text-[14.5px] mb-0.5 flex items-center gap-1.5">
              <FileText size={14} /> {p.title}
            </div>
            <div className="text-[12.5px] text-steel">
              {p.stepCount} pasos · {p.checklistCount} puntos de checklist
            </div>
          </div>
          <div className="flex items-center gap-2">
            {editable && (
              <button type="button" className="text-steel hover:text-red cursor-pointer" onClick={(e) => remove(p.id, e)}>
                <Trash2 size={15} />
              </button>
            )}
            <ChevronRight size={16} className="text-steel" />
          </div>
        </Link>
      ))}
    </div>
  );
}
