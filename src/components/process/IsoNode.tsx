import { Handle, Position, type NodeProps } from "@xyflow/react";
import { CheckSquare, FileText } from "lucide-react";

export type IsoShapeType =
  | "START"
  | "END"
  | "PROCESS"
  | "DECISION"
  | "IO"
  | "SUBPROCESS"
  | "DOCUMENT"
  | "PREPARE"
  | "STORAGE"
  | "CONNECTOR"
  | "CHECKLIST";

export type IsoNodeData = {
  shapeType: IsoShapeType;
  label: string;
  detail?: string;
  fileUrl?: string | null;
  fileName?: string | null;
  checklistItems?: { id: string; text: string }[];
};

const SHAPE_LABEL: Record<IsoShapeType, string> = {
  START: "Inicio",
  END: "Fin",
  PROCESS: "Proceso",
  DECISION: "Decisión",
  IO: "Entrada/Salida",
  SUBPROCESS: "Subproceso",
  DOCUMENT: "Documento",
  PREPARE: "Preparación",
  STORAGE: "Almacenamiento",
  CONNECTOR: "Conector",
  CHECKLIST: "Checklist",
};

export { SHAPE_LABEL };

function ShapeBody({ shapeType, label, detail, fileUrl, checklistItems }: IsoNodeData) {
  const base = "px-4 py-2.5 text-[12.5px] font-semibold text-center min-w-[130px] max-w-[220px]";

  if (shapeType === "START" || shapeType === "END") {
    return (
      <div className={`${base} bg-navy text-white rounded-full font-display`}>
        {label}
      </div>
    );
  }
  if (shapeType === "DECISION") {
    return (
      <div
        className="bg-white border-2 border-teal flex items-center justify-center text-center px-6 py-7 min-w-[140px] max-w-[170px] text-[12px] font-semibold"
        style={{ clipPath: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)" }}
      >
        {label}
      </div>
    );
  }
  if (shapeType === "IO") {
    return (
      <div
        className={`${base} bg-white border border-rule border-l-[3px] border-l-blue`}
        style={{ clipPath: "polygon(8% 0%, 100% 0%, 92% 100%, 0% 100%)" }}
      >
        {label}
      </div>
    );
  }
  if (shapeType === "SUBPROCESS") {
    return (
      <div
        className={`${base} bg-white border-t border-b border-rule`}
        style={{ borderLeft: "5px double #0B1F3A", borderRight: "5px double #0B1F3A" }}
      >
        {label}
      </div>
    );
  }
  if (shapeType === "DOCUMENT") {
    return (
      <div
        className={`${base} bg-white border border-rule border-l-[3px] border-l-blue`}
        style={{ clipPath: "polygon(0 0, 100% 0, 100% 78%, 75% 100%, 50% 82%, 25% 100%, 0 78%)", paddingBottom: 14 }}
      >
        <div className="flex items-center justify-center gap-1.5">
          {label}
          {fileUrl && <FileText size={12} className="text-blue shrink-0" />}
        </div>
      </div>
    );
  }
  if (shapeType === "PREPARE") {
    return (
      <div
        className={`${base} bg-white border border-rule`}
        style={{ clipPath: "polygon(16% 0%, 84% 0%, 100% 50%, 84% 100%, 16% 100%, 0% 50%)" }}
      >
        {label}
      </div>
    );
  }
  if (shapeType === "STORAGE") {
    return (
      <div
        className={`${base} bg-white border border-rule`}
        style={{ borderRadius: "50% 50% 6px 6px / 18% 18% 6px 6px" }}
      >
        {label}
      </div>
    );
  }
  if (shapeType === "CONNECTOR") {
    return (
      <div className="bg-navy text-white rounded-full w-16 h-16 flex items-center justify-center text-center text-[10.5px] font-semibold p-1">
        {label}
      </div>
    );
  }
  if (shapeType === "CHECKLIST") {
    return (
      <div className={`${base} bg-white border border-rule border-l-[3px] border-l-teal rounded text-left`}>
        <div className="font-display flex items-center gap-1.5">
          <CheckSquare size={13} className="text-teal shrink-0" /> {label}
        </div>
        <div className="text-[11px] font-normal text-steel mt-1">
          {(checklistItems?.length ?? 0)} punto{(checklistItems?.length ?? 0) === 1 ? "" : "s"}
        </div>
      </div>
    );
  }
  // PROCESS (default rectangle)
  return (
    <div className={`${base} bg-white border border-rule border-l-[3px] border-l-blue rounded text-left`}>
      <div className="font-display">{label}</div>
      {detail && <div className="text-[11px] font-normal text-steel mt-1">{detail}</div>}
    </div>
  );
}

const HANDLE_SIDES = [
  { pos: Position.Top, key: "top" },
  { pos: Position.Right, key: "right" },
  { pos: Position.Bottom, key: "bottom" },
  { pos: Position.Left, key: "left" },
] as const;

export function IsoNode({ data, selected }: NodeProps & { data: IsoNodeData }) {
  return (
    <div className={selected ? "ring-2 ring-blue rounded-sm" : ""}>
      {HANDLE_SIDES.map(({ pos, key }) => (
        <div key={key}>
          <Handle type="target" position={pos} id={`${key}-target`} className="!bg-steel" />
          <Handle type="source" position={pos} id={`${key}-source`} className="!bg-steel" />
        </div>
      ))}
      <ShapeBody {...data} />
    </div>
  );
}
