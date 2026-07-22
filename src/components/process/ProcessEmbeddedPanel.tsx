"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Eye, Plus, Trash2 } from "lucide-react";
import { ProcessEditor, type ProcessDTO } from "./ProcessEditor";
import { ProcessHistoryPanel, type ProcessUpdateDTO } from "./ProcessHistoryPanel";

// Shows the department's process directly — the visual flowchart, exactly
// as everyone in the area sees it — with no intermediate list/click step.
// Editing (moving steps, changing detail) only opens behind the "Editar"
// button, and only for whoever can edit this department at all.
export function ProcessEmbeddedPanel({
  deptId,
  process,
  updates,
  editable,
}: {
  deptId: string;
  process: ProcessDTO | null;
  updates: ProcessUpdateDTO[];
  editable: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  const createProcess = async () => {
    setBusy(true);
    await fetch("/api/processes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deptId, title: "Proceso de trabajo" }),
    });
    setBusy(false);
    router.refresh();
  };

  const removeProcess = async () => {
    if (!process) return;
    setBusy(true);
    await fetch(`/api/processes/${process.id}`, { method: "DELETE" });
    setBusy(false);
    setEditing(false);
    router.refresh();
  };

  if (!process) {
    return (
      <div className="border-[1.5px] border-dashed border-rule rounded-md p-8.5 text-center text-steel text-[13.5px]">
        <div className="mb-3">Todavía no hay un proceso documentado para esta área.</div>
        {editable && (
          <button
            type="button"
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded border border-blue bg-blue px-3.5 py-2 text-[12.5px] font-semibold text-white cursor-pointer disabled:opacity-60"
            onClick={createProcess}
          >
            <Plus size={14} /> Crear proceso
          </button>
        )}
      </div>
    );
  }

  return (
    <div>
      {editable && (
        <div className="flex items-center justify-end gap-3 mb-3">
          <button
            type="button"
            disabled={busy}
            className="text-red text-[12.5px] inline-flex items-center gap-1.5 cursor-pointer"
            onClick={removeProcess}
          >
            <Trash2 size={13} /> Eliminar proceso
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded border border-rule px-3 py-1.5 text-[12.5px] font-semibold hover:border-blue cursor-pointer"
            onClick={() => setEditing((e) => !e)}
          >
            {editing ? (
              <>
                <Eye size={13} /> Ver
              </>
            ) : (
              <>
                <Pencil size={13} /> Editar
              </>
            )}
          </button>
        </div>
      )}
      <ProcessEditor process={process} backHref="" editable={editing} hideBackLink />
      <ProcessHistoryPanel updates={updates} />
    </div>
  );
}
