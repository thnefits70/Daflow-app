"use client";

import { useState } from "react";
import { GitBranch, FileText, GraduationCap, LineChart } from "lucide-react";
import { ProcessListPanel } from "@/components/process/ProcessListPanel";
import { DocumentsPanel } from "@/components/documents/DocumentsPanel";
import { ExamsPanel } from "@/components/exams/ExamsPanel";
import { FinanceKpiPanel, type FinanceKpiDTO } from "@/components/finance/FinanceKpiPanel";

type ProcessSummary = { id: string; title: string; description: string; stepCount: number; checklistCount: number };
type DocumentDTO = { id: string; title: string; content: string; link: string; fileUrl: string | null; fileName: string | null };
type ExamSummary = { id: string; title: string; questionCount: number };

const ALL_TABS = [
  { key: "procesos", label: "Procesos", icon: GitBranch },
  { key: "documentos", label: "Documentos", icon: FileText },
  { key: "examenes", label: "Exámenes", icon: GraduationCap },
  { key: "kpis", label: "KPIs financieros", icon: LineChart },
] as const;

type TabKey = (typeof ALL_TABS)[number]["key"];

export function DeptWorkspaceTabs({
  deptId,
  processesBaseHref,
  processes,
  documents,
  exams,
  trackKpis = false,
  kpiRecords = [],
  editable,
  kpisEditable,
}: {
  deptId: string;
  processesBaseHref: string;
  processes: ProcessSummary[];
  documents: DocumentDTO[];
  exams: ExamSummary[];
  trackKpis?: boolean;
  kpiRecords?: FinanceKpiDTO[];
  editable: boolean;
  kpisEditable?: boolean;
}) {
  const [tab, setTab] = useState<TabKey>("procesos");
  const tabs = ALL_TABS.filter((t) => (t.key === "kpis" ? trackKpis : true));

  return (
    <div>
      <div className="flex gap-5.5 border-b border-rule mb-5.5">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`pb-2.5 text-[13px] font-semibold flex items-center gap-1.5 border-b-2 cursor-pointer ${
              tab === t.key ? "text-ink border-teal" : "text-steel border-transparent hover:text-ink"
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
      {tab === "kpis" && trackKpis && (
        <FinanceKpiPanel deptId={deptId} records={kpiRecords} editable={kpisEditable ?? editable} />
      )}
    </div>
  );
}
