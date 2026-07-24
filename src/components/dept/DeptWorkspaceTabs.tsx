"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { GitBranch, FileText, GraduationCap, LineChart, TrendingUp, MessageSquare, CalendarClock, BellRing, Receipt } from "lucide-react";
import { ProcessEmbeddedPanel } from "@/components/process/ProcessEmbeddedPanel";
import type { ProcessDTO } from "@/components/process/ProcessEditor";
import type { ProcessUpdateDTO } from "@/components/process/ProcessHistoryPanel";
import { PeriodicRemindersPanel } from "@/components/process/PeriodicRemindersPanel";
import type { PeriodicReminderDTO } from "@/lib/periodicReminders";
import { DocumentsPanel } from "@/components/documents/DocumentsPanel";
import { ExamsPanel } from "@/components/exams/ExamsPanel";
import { PurchaseReceiptsPanel } from "@/components/purchases/PurchaseReceiptsPanel";
import type { PurchaseReceiptDTO } from "@/lib/purchaseReceipts";
import { FinanceKpiWorkspace } from "@/components/finance/FinanceKpiWorkspace";
import type { FinanceKpiDataDTO } from "@/lib/financeKpis";
import { PaymentRemindersPanel } from "@/components/finance/PaymentRemindersPanel";
import type { PaymentReminderDTO } from "@/lib/paymentReminders";
import { WeeklyMetricPanel, type WeeklyMetricDTO } from "@/components/fulfillment/WeeklyMetricPanel";
import { WeeklyReviewPanel, type WeeklyReviewDTO } from "@/components/marketanalysis/WeeklyReviewPanel";

type DocumentDTO = { id: string; title: string; content: string; link: string; fileUrl: string | null; fileName: string | null };
type ExamSummary = { id: string; title: string; questionCount: number };

// Orden confirmado 2026-07-23: financiero/operativo primero, luego lo
// documental, Recordatorios al final.
const ALL_TABS = [
  { key: "kpis", label: "KPIs financieros", icon: LineChart },
  { key: "pagos", label: "Pagos recordatorios", icon: CalendarClock },
  { key: "semanal", label: "Pedidos despachados", icon: TrendingUp },
  { key: "feedback", label: "Feedback semanal", icon: MessageSquare },
  { key: "procesos", label: "Procesos", icon: GitBranch },
  { key: "comprobante", label: "Comprobante de pago", icon: Receipt },
  { key: "documentos", label: "Documentos", icon: FileText },
  { key: "examenes", label: "Exámenes", icon: GraduationCap },
  { key: "recordatorios", label: "Recordatorios", icon: BellRing },
] as const;

type TabKey = (typeof ALL_TABS)[number]["key"];

export function DeptWorkspaceTabs({
  deptId,
  activeProcess,
  processUpdates = [],
  periodicReminders = [],
  documents,
  exams,
  trackKpis = false,
  financeKpiData,
  trackPaymentReminders = false,
  paymentReminders = [],
  trackWeeklyMetric = false,
  weeklyMetricRecords = [],
  trackWeeklyReview = false,
  weeklyReviewRecords = [],
  canViewPurchaseReceipts = false,
  purchaseReceipts = [],
  isAdmin = false,
  editable,
  kpisEditable,
  unseenFeedbackCount = 0,
}: {
  deptId: string;
  activeProcess: ProcessDTO | null;
  processUpdates?: ProcessUpdateDTO[];
  periodicReminders?: PeriodicReminderDTO[];
  documents: DocumentDTO[];
  exams: ExamSummary[];
  trackKpis?: boolean;
  financeKpiData?: FinanceKpiDataDTO;
  trackPaymentReminders?: boolean;
  paymentReminders?: PaymentReminderDTO[];
  trackWeeklyMetric?: boolean;
  weeklyMetricRecords?: WeeklyMetricDTO[];
  trackWeeklyReview?: boolean;
  weeklyReviewRecords?: WeeklyReviewDTO[];
  // Comprobante de pago (Gestión de Compras) — unlike the trackXxx flags
  // above, this gates the tab per-VIEWER (leader/admin/explicitly granted),
  // not per-department, so nobody else on the team even sees it exists.
  canViewPurchaseReceipts?: boolean;
  purchaseReceipts?: PurchaseReceiptDTO[];
  isAdmin?: boolean;
  editable: boolean;
  kpisEditable?: boolean;
  unseenFeedbackCount?: number;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>(trackKpis ? "kpis" : "procesos");
  const [seenFeedback, setSeenFeedback] = useState(false);
  const tabs = ALL_TABS.filter((t) => {
    if (t.key === "kpis") return trackKpis;
    if (t.key === "pagos") return trackPaymentReminders;
    if (t.key === "semanal") return trackWeeklyMetric;
    if (t.key === "feedback") return trackWeeklyReview;
    if (t.key === "comprobante") return canViewPurchaseReceipts;
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
        <ProcessEmbeddedPanel deptId={deptId} process={activeProcess} updates={processUpdates} editable={editable} />
      )}
      {tab === "recordatorios" && (
        <PeriodicRemindersPanel deptId={deptId} reminders={periodicReminders} editable={kpisEditable ?? editable} />
      )}
      {tab === "comprobante" && canViewPurchaseReceipts && (
        <PurchaseReceiptsPanel deptId={deptId} receipts={purchaseReceipts} editable={canViewPurchaseReceipts} isAdmin={isAdmin} />
      )}
      {tab === "documentos" && <DocumentsPanel deptId={deptId} documents={documents} editable={editable} />}
      {tab === "examenes" && <ExamsPanel deptId={deptId} exams={exams} editable={editable} />}
      {tab === "kpis" && trackKpis && financeKpiData && (
        <FinanceKpiWorkspace deptId={deptId} data={financeKpiData} editable={kpisEditable ?? editable} />
      )}
      {tab === "pagos" && trackPaymentReminders && (
        <PaymentRemindersPanel deptId={deptId} reminders={paymentReminders} editable={kpisEditable ?? editable} />
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
