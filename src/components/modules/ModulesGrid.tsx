"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2, GripVertical, GraduationCap, FileText } from "lucide-react";
import { iconForModule } from "@/lib/moduleIcons";

export type ModuleSummaryDTO = {
  id: string;
  title: string;
  imageUrl: string | null;
  order: number;
  documentCount: number;
  examId: string | null;
  examQuestionCount: number;
};

export function ModulesGrid({
  modules,
  editable,
  basePath,
}: {
  modules: ModuleSummaryDTO[];
  editable: boolean;
  basePath: string;
}) {
  const router = useRouter();
  const [list, setList] = useState(modules);
  const [prevModules, setPrevModules] = useState(modules);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  if (modules !== prevModules) {
    setPrevModules(modules);
    setList(modules);
  }

  const create = async () => {
    setBusy(true);
    const res = await fetch("/api/modules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Nuevo módulo" }),
    });
    setBusy(false);
    if (!res.ok) return;
    const created = await res.json();
    router.refresh();
    router.push(`${basePath}/${created.id}`);
  };

  const remove = async (id: string, title: string) => {
    if (!confirm(`¿Eliminar el módulo "${title}"? Se borrarán también sus documentos y su examen. Esta acción no se puede deshacer.`)) return;
    setBusy(true);
    await fetch(`/api/modules/${id}`, { method: "DELETE" });
    setBusy(false);
    router.refresh();
  };

  const reorder = async (fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx || fromIdx === null) return;
    const next = [...list];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    setList(next);
    await fetch("/api/modules/reorder", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds: next.map((m) => m.id) }),
    });
    router.refresh();
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="text-[13px] text-steel max-w-2xl">
          Cada módulo agrupa contenido de referencia (notas, PDFs, enlaces) y, opcionalmente, un examen para
          verificar que el equipo lo entendió.
        </div>
        {editable && (
          <button
            type="button"
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded border border-blue bg-blue px-3.5 py-2 text-[12.5px] font-semibold text-white cursor-pointer disabled:opacity-60 shrink-0"
            onClick={create}
          >
            <Plus size={14} /> Nuevo módulo
          </button>
        )}
      </div>

      {list.length === 0 && (
        <div className="border-[1.5px] border-dashed border-rule rounded-md p-8.5 text-center text-steel text-[13.5px]">
          Aún no hay módulos.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3.5">
        {list.map((m, idx) => (
          <div
            key={m.id}
            draggable={editable}
            onDragStart={() => setDragIdx(idx)}
            onDragOver={(e) => editable && e.preventDefault()}
            onDrop={(e) => {
              if (!editable) return;
              e.preventDefault();
              reorder(dragIdx ?? idx, idx);
              setDragIdx(null);
            }}
            onDragEnd={() => setDragIdx(null)}
            className={`relative bg-surface border border-rule rounded-md overflow-hidden group ${dragIdx === idx ? "opacity-40" : ""}`}
          >
            <Link href={`${basePath}/${m.id}`} className="block">
              <div className="h-28 bg-cloud flex items-center justify-center overflow-hidden">
                {m.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.imageUrl} alt={m.title} className="w-full h-full object-cover" />
                ) : (
                  (() => {
                    const { Icon, color } = iconForModule(m.title);
                    return <Icon size={30} style={{ color }} strokeWidth={1.75} />;
                  })()
                )}
              </div>
              <div className="p-3">
                <div className="font-semibold text-[13.5px] mb-1 line-clamp-2">{m.title}</div>
                <div className="flex items-center gap-2.5 text-[11px] text-steel">
                  <span className="inline-flex items-center gap-1">
                    <FileText size={11} /> {m.documentCount}
                  </span>
                  {m.examId && (
                    <span className="inline-flex items-center gap-1">
                      <GraduationCap size={11} /> {m.examQuestionCount}
                    </span>
                  )}
                </div>
              </div>
            </Link>
            {editable && (
              <div className="absolute top-1.5 right-1.5 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  className="p-1 rounded bg-navy/80 text-white cursor-pointer"
                  onClick={(e) => {
                    e.preventDefault();
                    remove(m.id, m.title);
                  }}
                  title="Eliminar módulo"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            )}
            {editable && (
              <div className="absolute top-1.5 left-1.5 p-1 rounded bg-navy/60 text-white cursor-grab opacity-0 group-hover:opacity-100 transition-opacity">
                <GripVertical size={13} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
