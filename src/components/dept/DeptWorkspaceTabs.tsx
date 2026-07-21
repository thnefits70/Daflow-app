"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { GitBranch, FileText, GraduationCap, LineChart, TrendingUp, MessageSquare } from "lucide-react";
import { ProcessListPanel } from "@/components/process/ProcessListPanel";
import { DocumentsPanel } from "@/components/documents/DocumentsPanel";
import { ExamsPanel } from "@/components/exams/ExamsPanel";
import { FinanceKpiWorkspace } from "@/components/finance/FinanceKpiWorkspace";
import type { FinanceKpiDataDTO } from "@/lib/financeKpis";
import { WeeklyMetricPanel, type WeeklyMetricDTO } from "@/components/fulfillment/WeeklyMetricPanel";
import { WeeklyReviewPanel, type WeeklyReviewDTO } from "@/components/marketanalysis/WeeklyReviewPanel";

type ProcessSummary = { id: string; title: string; description: string; stepCount: number; checklistCount: number };
type DocumentDTO = { id: string; title: string; content: string; link: string; fileUrl: string | null; fileName: string | null };
type ExamSummary = { id: string; title: string; questionCount: number };

const ALL_TABS = [
  { key: "procesos", label: "Procesos", icon: GitBranch },
  { key: "documentos", label: "Documentos", icon: FileText },
  { key: "examenes", label: "Exámenes", icon: GraduationCap },
  { key: "kpis", label: "KPIs financieros", icon: LineChart },
  { key: "semanal", label: "Pedidos despachados", icon: TrendingUp },
  { key: "feedback", label: "Feedback semanal", icon: MessageSquare },
] as const;

type TabKey = (typeof ALL_TABS)[number]["key"];

export function DeptWorkspaceTabs({
  deptId,
  processesBaseHref,
  processes,
  documents,
  exams,
  trackKpis = false,
  financeKpiData,
  trackWeeklyMetric = false,
  weeklyMetricRecords = [],
  trackWeeklyReview = false,
  weeklyReviewRecords = [],
  editable,
  kpisEditable,
  unseenFeedbackCount = 0,
}: {
  deptId: string;
  processesBaseHref: string;
  processes: ProcessSummary[];
  documents: DocumentDTO[];
  exams: ExamSummary[];
  trackKpis?: boolean;
  financeKpiData?: FinanceKpiDataDTO;
  trackWeeklyMetric?: boolean;
  weeklyMetricRecords?: WeeklyMetricDTO[];
  trackWeeklyReview?: boolean;
  weeklyReviewRecords?: WeeklyReviewDTO[];
  editable: boolean;
  kpisEditable?: boolean;
  unseenFeedbackCount?: number;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>("procesos");
  const [seenFeedback, setSeenFeedback] = useState(false);
  const tabs = ALL_TABS.filter((t) => {
    if (t.key === "kpis") return trackKpis;
    if (t.key === "semanal") return trackWeeklyMetric;
    if (t.key === "feedback") return trackWeeklyReview;
    return true;
  });

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
            onClick={() => {
              setTab(t.key);
              if (t.key === "feedback" && unseenFeedbackCount > 0 && !seenFeedback) {
                setSeenFeedback(true);
                fetch("/api/me/seen-feedback", { method: "POST" }).then(() => router.refresh());
              }
            }}
          >
            <t.icon size={14} /> {t.label}
            {t.key === "feedback" && unseenFeedbackCount > 0 && !seenFeedback && (
              <span className="font-mono text-[10px] font-semibold bg-red/20 text-red rounded-full px-1.5 py-0.5">
                {unseenFeedbackCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "procesos" && (
        <ProcessListPanel deptId={deptId} editable={editable} baseHref={processesBaseHref} processes={processes} />
      )}
      {tab === "documentos" && <DocumentsPanel deptId={deptId} documents={documents} editable={editable} />}
      {tab === "examenes" && <ExamsPanel deptId={deptId} exams={exams} editable={editable} />}
      {tab === "kpis" && trackKpis && financeKpiData && (
        <FinanceKpiWorkspace deptId={deptId} data={financeKpiData} editable={kpisEditable ?? editable} />
      )}
      {tab === "semanal" && trackWeeklyMetric && (
        <WeeklyMetricPanel
          deptId={deptId}
          records={weeklyMetricRecords}
          editable={kpisEditable ?? editable}
          label="Pedidos despachados"
        />
      )}
      {tab === "feedback" && trackWeeklyReview && (
        <WeeklyReviewPanel deptId={deptId} records={weeklyReviewRecords} editable={editable} />
      )}
    </div>
  );
}
