"use client";

import { useState } from "react";
import { GitBranch, FileText, GraduationCap, ShieldCheck } from "lucide-react";
import { ProcessListPanel } from "@/components/process/ProcessListPanel";
import { DeptUsersPanel } from "@/components/users/DeptUsersPanel";
import { DocumentsPanel } from "@/components/documents/DocumentsPanel";
import { ExamsPanel } from "@/components/exams/ExamsPanel";

type ProcessSummary = { id: string; title: string; description: string; stepCount: number; checklistCount: number };
type DeptUser = { id: string; name: string; username: string; position: string | null };
type Position = { id: string; name: string };
type DocumentDTO = { id: string; title: string; content: string; link: string; fileUrl: string | null; fileName: string | null };
type ExamSummary = { id: string; title: string; questionCount: number };

const ALL_TABS = [
  { key: "procesos", label: "Procesos", icon: GitBranch },
  { key: "documentos", label: "Documentos", icon: FileText },
  { key: "examenes", label: "Exámenes", icon: GraduationCap },
  { key: "usuarios", label: "Usuarios", icon: ShieldCheck },
] as const;

type TabKey = (typeof ALL_TABS)[number]["key"];

export function DeptWorkspaceTabs({
  deptId,
  processesBaseHref,
  processes,
  users,
  positions,
  documents,
  exams,
  editable,
}: {
  deptId: string;
  processesBaseHref: string;
  processes: ProcessSummary[];
  users: DeptUser[];
  positions: Position[];
  documents: DocumentDTO[];
  exams: ExamSummary[];
  editable: boolean;
}) {
  const [tab, setTab] = useState<TabKey>("procesos");
  const tabs = editable ? ALL_TABS : ALL_TABS.filter((t) => t.key !== "usuarios");

  return (
    <div>
      <div className="flex gap-5.5 border-b border-rule mb-5.5">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`pb-2.5 text-[13px] font-semibold flex items-center gap-1.5 border-b-2 cursor-pointer ${
              tab === t.key ? "text-navy border-teal" : "text-steel border-transparent hover:text-navy"
            }`}
            onClick={() => setTab(t.key)}
          >
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      {tab === "procesos" && (
        <ProcessListPanel deptId={deptId} editable={editable} baseHref={processesBaseHref} processes={processes} />
      )}
      {tab === "documentos" && <DocumentsPanel deptId={deptId} documents={documents} editable={editable} />}
      {tab === "examenes" && <ExamsPanel deptId={deptId} exams={exams} editable={editable} />}
      {tab === "usuarios" && editable && <DeptUsersPanel deptId={deptId} users={users} positions={positions} />}
    </div>
  );
}
