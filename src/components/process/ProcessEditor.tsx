"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  MarkerType,
  type Node,
  type Edge,
  type Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Plus, Trash2, CheckCircle2, Circle, ArrowLeft, Upload, X, Download } from "lucide-react";
import Link from "next/link";
import { IsoNode, SHAPE_LABEL, type IsoShapeType, type IsoNodeData } from "./IsoNode";

const nodeTypes = { iso: IsoNode };

type Branch = {
  id: string;
  label: string;
  targetStepId: string | null;
  sourceHandle?: string | null;
  targetHandle?: string | null;
};
type StepChecklistItemDTO = { id: string; text: string };
type FlowStepDTO = {
  id: string;
  type: IsoShapeType;
  label: string;
  detail: string;
  fileUrl?: string | null;
  fileName?: string | null;
  positionX: number;
  positionY: number;
  branches: Branch[];
  checklistItems?: StepChecklistItemDTO[];
};
type ChecklistItemDTO = { id: string; text: string };
export type ProcessDTO = {
  id: string;
  title: string;
  description: string;
  flowSteps: FlowStepDTO[];
  checklistItems: ChecklistItemDTO[];
};

const TOOLBAR_SHAPES: IsoShapeType[] = [
  "START",
  "PROCESS",
  "DECISION",
  "IO",
  "SUBPROCESS",
  "DOCUMENT",
  "PREPARE",
  "STORAGE",
  "CONNECTOR",
  "CHECKLIST",
  "END",
];

function stepsToNodes(steps: FlowStepDTO[]): Node<IsoNodeData>[] {
  return steps.map((s) => ({
    id: s.id,
    type: "iso",
    position: { x: s.positionX, y: s.positionY },
    data: {
      shapeType: s.type,
      label: s.label,
      detail: s.detail,
      fileUrl: s.fileUrl,
      fileName: s.fileName,
      checklistItems: s.checklistItems ?? [],
    },
  }));
}

function stepsToEdges(steps: FlowStepDTO[]): Edge[] {
  const edges: Edge[] = [];
  for (const s of steps) {
    for (const b of s.branches) {
      if (!b.targetStepId) continue;
      edges.push({
        id: b.id,
        source: s.id,
        target: b.targetStepId,
        sourceHandle: b.sourceHandle || "bottom-source",
        targetHandle: b.targetHandle || "top-target",
        label: b.label || undefined,
        type: "smoothstep",
        markerEnd: { type: MarkerType.ArrowClosed },
      });
    }
  }
  return edges;
}

export function ProcessEditor({
  process,
  backHref,
  editable,
  hideBackLink,
}: {
  process: ProcessDTO;
  backHref: string;
  editable: boolean;
  hideBackLink?: boolean;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(process.title);
  const [description, setDescription] = useState(process.description);
  const [checklist, setChecklist] = useState<{ id: string; text: string }[]>(process.checklistItems);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<IsoNodeData>>(stepsToNodes(process.flowSteps));
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(stepsToEdges(process.flowSteps));
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const selectedNode = useMemo(() => nodes.find((n) => n.id === selectedNodeId) ?? null, [nodes, selectedNodeId]);
  const selectedEdge = useMemo(() => edges.find((e) => e.id === selectedEdgeId) ?? null, [edges, selectedEdgeId]);

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) =>
        addEdge({ ...connection, type: "smoothstep", markerEnd: { type: MarkerType.ArrowClosed } }, eds)
      );
    },
    [setEdges]
  );

  const addNode = (type: IsoShapeType) => {
    const id = crypto.randomUUID();
    setNodes((nds) => {
      const count = nds.length;
      return [
        ...nds,
        {
          id,
          type: "iso",
          position: { x: 60 + (count % 4) * 190, y: 60 + Math.floor(count / 4) * 150 },
          data: { shapeType: type, label: SHAPE_LABEL[type], detail: "" },
        },
      ];
    });
  };

  const updateSelectedNode = (patch: Partial<IsoNodeData>) => {
    if (!selectedNodeId) return;
    setNodes((nds) =>
      nds.map((n) => (n.id === selectedNodeId ? { ...n, data: { ...n.data, ...patch } } : n))
    );
  };

  const deleteSelectedNode = () => {
    if (!selectedNodeId) return;
    setNodes((nds) => nds.filter((n) => n.id !== selectedNodeId));
    setEdges((eds) => eds.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId));
    setSelectedNodeId(null);
  };

  const updateSelectedEdgeLabel = (label: string) => {
    if (!selectedEdgeId) return;
    setEdges((eds) => eds.map((e) => (e.id === selectedEdgeId ? { ...e, label } : e)));
  };

  const deleteSelectedEdge = () => {
    if (!selectedEdgeId) return;
    setEdges((eds) => eds.filter((e) => e.id !== selectedEdgeId));
    setSelectedEdgeId(null);
  };

  const addChecklistItem = () =>
    setChecklist((c) => [...c, { id: crypto.randomUUID(), text: "Nuevo punto de verificación" }]);
  const updateChecklistItem = (id: string, text: string) =>
    setChecklist((c) => c.map((item) => (item.id === id ? { ...item, text } : item)));
  const removeChecklistItem = (id: string) => setChecklist((c) => c.filter((item) => item.id !== id));

  // --- Checklist items scoped to the currently selected CHECKLIST-type node ---
  const addNodeChecklistItem = () => {
    if (!selectedNodeId) return;
    updateSelectedNode({
      checklistItems: [...(selectedNode?.data.checklistItems ?? []), { id: crypto.randomUUID(), text: "Nuevo punto" }],
    });
  };
  const updateNodeChecklistItem = (itemId: string, text: string) => {
    if (!selectedNode) return;
    updateSelectedNode({
      checklistItems: (selectedNode.data.checklistItems ?? []).map((it) => (it.id === itemId ? { ...it, text } : it)),
    });
  };
  const removeNodeChecklistItem = (itemId: string) => {
    if (!selectedNode) return;
    updateSelectedNode({
      checklistItems: (selectedNode.data.checklistItems ?? []).filter((it) => it.id !== itemId),
    });
  };

  const [uploadErr, setUploadErr] = useState("");
  const [uploading, setUploading] = useState(false);
  const uploadNodeFile = async (file: File) => {
    setUploadErr("");
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("folder", "process-documents");
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    setUploading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setUploadErr(data?.error ?? "No se pudo subir el archivo.");
      return;
    }
    const data = await res.json();
    updateSelectedNode({ fileUrl: data.url, fileName: data.name });
  };

  const toggleChecked = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const save = async (notify = false) => {
    setSaving(true);
    const res = await fetch(`/api/processes/${process.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        description,
        checklist: checklist.map((c) => ({ text: c.text })),
        flow: {
          nodes: nodes.map((n) => ({
            clientId: n.id,
            type: n.data.shapeType,
            label: n.data.label,
            detail: n.data.detail ?? "",
            fileUrl: n.data.fileUrl ?? null,
            fileName: n.data.fileName ?? null,
            checklistItems: (n.data.checklistItems ?? []).map((c) => ({ text: c.text })),
            positionX: n.position.x,
            positionY: n.position.y,
          })),
          edges: edges.map((e) => ({
            sourceClientId: e.source,
            targetClientId: e.target,
            sourceHandle: e.sourceHandle ?? null,
            targetHandle: e.targetHandle ?? null,
            label: typeof e.label === "string" ? e.label : "",
          })),
        },
      }),
    });
    setSaving(false);
    if (!res.ok) return;

    if (notify) {
      await fetch(`/api/processes/${process.id}/notify`, { method: "POST" });
    }

    // Refetch so local node/edge ids match the freshly persisted rows.
    const fresh: ProcessDTO = await fetch(`/api/processes/${process.id}`).then((r) => r.json());
    setNodes(stepsToNodes(fresh.flowSteps));
    setEdges(stepsToEdges(fresh.flowSteps));
    setChecklist(fresh.checklistItems);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setSavedAt(Date.now());
    router.refresh();
  };

  return (
    <div>
      {!hideBackLink && (
        <Link href={backHref} className="inline-flex items-center gap-1.5 text-[13px] text-steel hover:text-ink mb-4.5">
          <ArrowLeft size={14} /> Volver
        </Link>
      )}

      {editable ? (
        <div className="mb-5 space-y-2.5">
          <input
            className="w-full font-display text-[22px] font-bold border-none bg-transparent outline-none focus:ring-0 px-0"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <textarea
            className="w-full rounded border border-rule bg-surface px-2.5 py-2 text-[13px] text-steel"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
      ) : (
        <div className="mb-5">
          <h2 className="font-display text-[22px] font-bold">{title}</h2>
          {description && <p className="text-[13.5px] text-steel mt-1.5 max-w-2xl">{description}</p>}
        </div>
      )}

      {editable && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {TOOLBAR_SHAPES.map((t) => (
            <button
              key={t}
              type="button"
              className="text-[11.5px] font-semibold border border-rule bg-surface rounded px-2.5 py-1.5 hover:border-blue cursor-pointer"
              onClick={() => addNode(t)}
            >
              + {SHAPE_LABEL[t]}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-[1fr_280px] gap-3 min-w-0">
        <div className="bg-white border border-[#D6DEEA] rounded min-w-0" style={{ height: 480, width: "100%" }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={editable ? onNodesChange : undefined}
            onEdgesChange={editable ? onEdgesChange : undefined}
            onConnect={editable ? onConnect : undefined}
            nodeTypes={nodeTypes}
            nodesDraggable={editable}
            nodesConnectable={editable}
            elementsSelectable
            onNodeClick={(_e, node) => { setSelectedNodeId(node.id); setSelectedEdgeId(null); }}
            onEdgeClick={editable ? (_e, edge) => { setSelectedEdgeId(edge.id); setSelectedNodeId(null); } : undefined}
            onPaneClick={() => { setSelectedNodeId(null); setSelectedEdgeId(null); }}
            fitView
          >
            <Background />
            <Controls showInteractive={editable} />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>

        <div className="bg-surface border border-rule rounded p-3.5">
          {!editable && selectedNode ? (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-2">
                {SHAPE_LABEL[selectedNode.data.shapeType]}
              </div>
              <div className="font-display font-semibold text-[14px] mb-2">{selectedNode.data.label}</div>

              {selectedNode.data.shapeType === "CHECKLIST" ? (
                <div className="border border-rule rounded">
                  {(selectedNode.data.checklistItems ?? []).length === 0 && (
                    <div className="text-steel text-[12px] p-3 text-center">Sin puntos.</div>
                  )}
                  {(selectedNode.data.checklistItems ?? []).map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-2 px-2.5 py-2 border-b border-rule last:border-b-0 cursor-pointer"
                      onClick={() => toggleChecked(item.id)}
                    >
                      {checked.has(item.id) ? (
                        <CheckCircle2 size={15} className="text-green shrink-0" />
                      ) : (
                        <Circle size={15} className="text-steel shrink-0" />
                      )}
                      <span className={`text-[12.5px] ${checked.has(item.id) ? "line-through text-steel" : ""}`}>
                        {item.text}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                selectedNode.data.detail && (
                  <p className="text-[12.5px] text-steel leading-relaxed mb-3">{selectedNode.data.detail}</p>
                )
              )}

              {selectedNode.data.shapeType === "DOCUMENT" && (
                <div className="mt-3">
                  {selectedNode.data.fileUrl ? (
                    <>
                      <a
                        href={selectedNode.data.fileUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-blue mb-2"
                      >
                        <Download size={12} /> Descargar PDF
                      </a>
                      <iframe
                        src={selectedNode.data.fileUrl}
                        title={selectedNode.data.fileName || "Documento"}
                        className="w-full border border-rule rounded"
                        style={{ height: 260 }}
                      />
                    </>
                  ) : (
                    <div className="text-steel text-[12px]">Sin PDF adjunto.</div>
                  )}
                </div>
              )}
            </div>
          ) : editable && selectedNode ? (
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-2">
                  {SHAPE_LABEL[selectedNode.data.shapeType]}
                </div>
                <div className="mb-2.5">
                  <label className="block mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">
                    Nombre
                  </label>
                  <input
                    className="w-full rounded border border-rule px-2 py-1.5 text-[13px]"
                    value={selectedNode.data.label}
                    onChange={(e) => updateSelectedNode({ label: e.target.value })}
                  />
                </div>
                {selectedNode.data.shapeType === "CHECKLIST" ? (
                  <div className="mb-3">
                    <label className="block mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">
                      Puntos de verificación
                    </label>
                    <div className="border border-rule rounded">
                      {(selectedNode.data.checklistItems ?? []).length === 0 && (
                        <div className="text-steel text-[12px] p-3 text-center">Sin puntos todavía.</div>
                      )}
                      {(selectedNode.data.checklistItems ?? []).map((item) => (
                        <div key={item.id} className="flex items-center gap-1.5 px-2 py-1.5">
                          <input
                            className="flex-1 rounded border border-rule px-1.5 py-1 text-[12.5px]"
                            value={item.text}
                            onChange={(e) => updateNodeChecklistItem(item.id, e.target.value)}
                          />
                          <button
                            type="button"
                            className="text-steel hover:text-red cursor-pointer"
                            onClick={() => removeNodeChecklistItem(item.id)}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        className="m-1.5 text-[11.5px] font-semibold text-steel border border-rule rounded px-2 py-1 inline-flex items-center gap-1 cursor-pointer"
                        onClick={addNodeChecklistItem}
                      >
                        <Plus size={11} /> Añadir punto
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mb-3">
                    <label className="block mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">
                      {selectedNode.data.shapeType === "DOCUMENT" ? "Notas" : "Detalle"}
                    </label>
                    <textarea
                      className="w-full rounded border border-rule px-2 py-1.5 text-[13px]"
                      rows={3}
                      value={selectedNode.data.detail ?? ""}
                      onChange={(e) => updateSelectedNode({ detail: e.target.value })}
                    />
                  </div>
                )}

                {selectedNode.data.shapeType === "DOCUMENT" && (
                  <div className="mb-3">
                    <label className="block mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">
                      Archivo PDF
                    </label>
                    {selectedNode.data.fileUrl ? (
                      <div className="flex items-center justify-between gap-2 border border-rule rounded px-2 py-1.5">
                        <span className="text-[12px] truncate">{selectedNode.data.fileName || "Archivo cargado"}</span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <a href={selectedNode.data.fileUrl} target="_blank" rel="noreferrer" className="text-steel hover:text-ink">
                            <Download size={13} />
                          </a>
                          <button
                            type="button"
                            className="text-steel hover:text-red cursor-pointer"
                            onClick={() => updateSelectedNode({ fileUrl: null, fileName: null })}
                          >
                            <X size={13} />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <label className="inline-flex items-center gap-1.5 text-[12px] font-semibold border border-rule rounded px-2.5 py-1.5 cursor-pointer">
                        <Upload size={12} /> {uploading ? "Subiendo…" : "Subir PDF"}
                        <input
                          type="file"
                          accept="application/pdf"
                          className="hidden"
                          disabled={uploading}
                          onChange={(e) => e.target.files?.[0] && uploadNodeFile(e.target.files[0])}
                        />
                      </label>
                    )}
                    {uploadErr && <div className="text-red text-[11.5px] mt-1.5">{uploadErr}</div>}
                  </div>
                )}

                <button
                  type="button"
                  className="text-red text-[12.5px] inline-flex items-center gap-1.5 cursor-pointer"
                  onClick={deleteSelectedNode}
                >
                  <Trash2 size={13} /> Eliminar paso
                </button>
              </div>
            ) : selectedEdge ? (
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-2">Conexión</div>
                <div className="mb-3">
                  <label className="block mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-steel">
                    Etiqueta (ej. Sí / No)
                  </label>
                  <input
                    className="w-full rounded border border-rule px-2 py-1.5 text-[13px]"
                    value={typeof selectedEdge.label === "string" ? selectedEdge.label : ""}
                    onChange={(e) => updateSelectedEdgeLabel(e.target.value)}
                  />
                </div>
                <button
                  type="button"
                  className="text-red text-[12.5px] inline-flex items-center gap-1.5 cursor-pointer"
                  onClick={deleteSelectedEdge}
                >
                  <Trash2 size={13} /> Eliminar conexión
                </button>
              </div>
            ) : (
              <div className="text-[12.5px] text-steel leading-relaxed">
                {editable
                  ? "Agrega símbolos con los botones de arriba, arrástralos al lienzo y conéctalos arrastrando desde cualquiera de los 4 puntos (arriba, abajo, izquierda o derecha) hasta otro símbolo. Haz clic en un símbolo o conexión para editarlo aquí."
                  : "Haz clic en un símbolo del flujograma para ver su detalle, checklist o documento adjunto."}
              </div>
            )}
        </div>
      </div>

      <div className="mt-6">
        <div className="flex items-center justify-between mb-2.5">
          <h3 className="text-[14px] font-semibold flex items-center gap-1.5">
            <CheckCircle2 size={15} /> Checklist
          </h3>
          {!editable && checked.size > 0 && (
            <button
              type="button"
              className="text-[11px] border border-rule rounded px-2.5 py-1 text-steel cursor-pointer"
              onClick={() => setChecked(new Set())}
            >
              Reiniciar
            </button>
          )}
        </div>
        <div className="bg-surface border border-rule rounded p-1">
          {checklist.length === 0 && (
            <div className="text-steel text-[13px] p-4 text-center">Sin checklist para este proceso.</div>
          )}
          {checklist.map((item) =>
            editable ? (
              <div key={item.id} className="flex items-center gap-2 px-2.5 py-1.5">
                <input
                  className="flex-1 rounded border border-rule px-2 py-1.5 text-[13px]"
                  value={item.text}
                  onChange={(e) => updateChecklistItem(item.id, e.target.value)}
                />
                <button type="button" className="text-steel hover:text-red cursor-pointer" onClick={() => removeChecklistItem(item.id)}>
                  <Trash2 size={14} />
                </button>
              </div>
            ) : (
              <div
                key={item.id}
                className="flex items-center gap-2.5 px-3 py-2.5 border-b border-rule last:border-b-0 cursor-pointer"
                onClick={() => toggleChecked(item.id)}
              >
                {checked.has(item.id) ? <CheckCircle2 size={17} className="text-green" /> : <Circle size={17} className="text-steel" />}
                <span className={`text-[13.5px] ${checked.has(item.id) ? "line-through text-steel" : ""}`}>{item.text}</span>
              </div>
            )
          )}
          {editable && (
            <button
              type="button"
              className="m-2 text-[12px] font-semibold text-steel border border-rule rounded px-2.5 py-1.5 inline-flex items-center gap-1.5 cursor-pointer"
              onClick={addChecklistItem}
            >
              <Plus size={12} /> Añadir punto
            </button>
          )}
        </div>
      </div>

      {editable && (
        <div className="mt-5 flex items-center gap-3 flex-wrap">
          <button
            type="button"
            disabled={saving}
            className="rounded border border-blue bg-blue px-5 py-2.5 text-[13px] font-semibold text-white cursor-pointer disabled:opacity-60"
            onClick={() => save(false)}
          >
            {saving ? "Guardando…" : "Guardar cambios"}
          </button>
          <button
            type="button"
            disabled={saving}
            className="rounded border border-teal bg-teal px-5 py-2.5 text-[13px] font-semibold text-navy cursor-pointer disabled:opacity-60"
            onClick={() => save(true)}
          >
            Guardar y notificar actualización obligatoria
          </button>
          {savedAt && <span className="text-[12px] text-steel">Guardado.</span>}
        </div>
      )}
      {editable && (
        <div className="text-[11.5px] text-steel mt-2">
          Esto avisará a todo el equipo de esta área que debe revisar el proceso actualizado.
        </div>
      )}
    </div>
  );
}
