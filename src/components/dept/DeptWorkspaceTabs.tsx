"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { GitBranch, FileText, GraduationCap, LineChart, TrendingUp, MessageSquare, CalendarClock, BellRing, Receipt, Heart, ShoppingCart, Package, Pin } from "lucide-react";
import { ProcessEmbeddedPanel } from "@/components/process/ProcessEmbeddedPanel";
import type { ProcessDTO } from "@/components/process/ProcessEditor";
import type { ProcessUpdateDTO } from "@/components/process/ProcessHistoryPanel";
import { PeriodicRemindersPanel } from "@/components/process/PeriodicRemindersPanel";
import type { PeriodicReminderDTO } from "@/lib/periodicReminders";
import { DocumentsPanel } from "@/components/documents/DocumentsPanel";
import { ExamsPanel } from "@/components/exams/ExamsPanel";
import { PurchaseReceiptsPanel } from "@/components/purchases/PurchaseReceiptsPanel";
import type { PurchaseReceiptDTO, PurchaseReceiptCatalogDTO } from "@/lib/purchaseReceipts";
import { StoreFeedbackPanel } from "@/components/finance/StoreFeedbackPanel";
import type { StoreDTO } from "@/lib/storeFeedback";
import { FinanceKpiWorkspace } from "@/components/finance/FinanceKpiWorkspace";
import type { FinanceKpiDataDTO } from "@/lib/financeKpis";
import { PaymentRemindersPanel } from "@/components/finance/PaymentRemindersPanel";
import type { PaymentReminderDTO } from "@/lib/paymentReminders";
import { WeeklyMetricPanel, type WeeklyMetricDTO } from "@/components/fulfillment/WeeklyMetricPanel";
import { WeeklyReviewPanel, type WeeklyReviewDTO } from "@/components/marketanalysis/WeeklyReviewPanel";
import { PurchaseControlPanel } from "@/components/purchases/PurchaseControlPanel";
import { InventoryControlPanel } from "@/components/inventory/InventoryControlPanel";
import type { StaleProductDTO } from "@/lib/inventoryKpis";

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
  { key: "compras", label: "Control de Compras", icon: ShoppingCart },
  { key: "inventario", label: "Control de Inventario", icon: Package },
  { key: "postventa", label: "Servicio Postventa", icon: Heart },
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
  purchaseReceiptSuppliers = [],
  purchaseReceiptBanks = [],
  canManageStoreFeedback = false,
  canViewStoreFeedback = false,
  storeFeedbackStores = [],
  canSubmitPurchases = false,
  canReceivePurchases = false,
  canInvoicePurchases = false,
  canManageInventoryControl = false,
  inventoryControlData = null,
  preferredTab = null,
  isAdmin = false,
  editable,
  kpisEditable,
  unseenFeedbackCount = 0,
  currentUserId = null,
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
  purchaseReceiptSuppliers?: PurchaseReceiptCatalogDTO[];
  purchaseReceiptBanks?: PurchaseReceiptCatalogDTO[];
  // Servicio Postventa (Análisis de Mercado) — same per-viewer gate pattern
  // as canViewPurchaseReceipts, not a per-department trackXxx flag. Two
  // tiers: canManageStoreFeedback (full edit) or canViewStoreFeedback
  // (read-only — confirmed 2026-07-25, for leaders like sales who should
  // see but never touch what Nairoby registered).
  canManageStoreFeedback?: boolean;
  canViewStoreFeedback?: boolean;
  storeFeedbackStores?: StoreDTO[];
  // Control de Compras — mismo patrón sin dept.code que Servicio Postventa
  // (confirmado 2026-07-30): Bryan y Nairoby están "asignados puntualmente"
  // a esto sin ser líderes formales de Control de Compras como departamento,
  // así que se ve en la propia "Mi área de trabajo" de cada quien sin
  // importar a qué departamento pertenezcan de verdad.
  canSubmitPurchases?: boolean;
  canReceivePurchases?: boolean;
  canInvoicePurchases?: boolean;
  // Control de Inventario — mismo patrón sin dept.code que Control de
  // Compras/Servicio Postventa (confirmado 2026-08-04): Daniel lo ve en su
  // propia "Mi área de trabajo" sin importar si su departamento real es INV.
  canManageInventoryControl?: boolean;
  inventoryControlData?: { period: string; currentInventoryValue: number | null; products: StaleProductDTO[]; currentQuarter: string } | null;
  isAdmin?: boolean;
  editable: boolean;
  kpisEditable?: boolean;
  unseenFeedbackCount?: number;
  // Confirmado 2026-07-28: "Recordatorios" ahora es personal — cada quien
  // gestiona los suyos (comparando createdById), sin importar si es líder.
  // null para admin (no es una fila real de User).
  currentUserId?: string | null;
  // Confirmado 2026-08-04: cada quien puede fijar su propia pestaña de
  // apertura (ej. Nairoby o el admin prefiriendo otra distinta a "Feedback
  // semanal", que ahora es el default de Finanzas). Null = usar el fallback.
  preferredTab?: string | null;
}) {
  const router = useRouter();
  const tabs = ALL_TABS.filter((t) => {
    if (t.key === "kpis") return trackKpis;
    if (t.key === "pagos") return trackPaymentReminders;
    if (t.key === "semanal") return trackWeeklyMetric;
    if (t.key === "feedback") return trackWeeklyReview;
    if (t.key === "comprobante") return canViewPurchaseReceipts;
    if (t.key === "compras") return canSubmitPurchases || canReceivePurchases || canInvoicePurchases;
    if (t.key === "inventario") return canManageInventoryControl;
    if (t.key === "postventa") return canManageStoreFeedback || canViewStoreFeedback;
    return true;
  });
  // Confirmado 2026-07-30: cada área debería abrir directo en su pestaña más
  // usada, no siempre en "Procesos" — Fulfillment abre en "Pedidos
  // despachados". Confirmado 2026-08-04: Finanzas ahora abre en "Feedback
  // semanal" en vez de KPIs (trackWeeklyReview solo existe ahí). Cualquiera
  // puede fijar su propia pestaña vía preferredTab, que gana sobre este
  // fallback si sigue siendo una pestaña visible para él.
  const fallbackTab: TabKey = trackWeeklyReview ? "feedback" : trackKpis ? "kpis" : trackWeeklyMetric ? "semanal" : "procesos";
  const initialTab = (preferredTab && tabs.some((t) => t.key === preferredTab) ? (preferredTab as TabKey) : fallbackTab);
  const [tab, setTab] = useState<TabKey>(initialTab);
  const [seenFeedback, setSeenFeedback] = useState(false);
  const [pinned, setPinned] = useState(false);

  async function pinCurrentTab() {
    setPinned(true);
    await fetch("/api/me/default-workspace-tab", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tab }),
    });
  }

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
              setPinned(false);
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
        {currentUserId && (
          <button
            type="button"
            className={`ml-auto pb-2.5 text-[11px] flex items-center gap-1 cursor-pointer ${pinned ? "text-teal" : "text-steel hover:text-ink"}`}
            onClick={pinCurrentTab}
            title="Abrir siempre en esta pestaña"
          >
            <Pin size={12} /> {pinned ? "Fijada" : "Fijar como mi pestaña de inicio"}
          </button>
        )}
      </div>

      {tab === "procesos" && (
        <ProcessEmbeddedPanel deptId={deptId} process={activeProcess} updates={processUpdates} editable={editable} />
      )}
      {tab === "recordatorios" && (
        <PeriodicRemindersPanel
          deptId={deptId}
          reminders={periodicReminders}
          canManageAll={kpisEditable ?? editable}
          currentUserId={currentUserId}
        />
      )}
      {tab === "comprobante" && canViewPurchaseReceipts && (
        <PurchaseReceiptsPanel
          deptId={deptId}
          receipts={purchaseReceipts}
          suppliers={purchaseReceiptSuppliers}
          banks={purchaseReceiptBanks}
          editable={canViewPurchaseReceipts}
          isAdmin={isAdmin}
        />
      )}
      {tab === "compras" && (canSubmitPurchases || canReceivePurchases || canInvoicePurchases) && (
        <PurchaseControlPanel
          deptId={deptId}
          canSubmit={canSubmitPurchases}
          canReview={isAdmin}
          canReceive={canReceivePurchases}
          canInvoice={canInvoicePurchases}
          isAdmin={isAdmin}
        />
      )}
      {tab === "inventario" && canManageInventoryControl && inventoryControlData && (
        <InventoryControlPanel
          period={inventoryControlData.period}
          currentInventoryValue={inventoryControlData.currentInventoryValue}
          products={inventoryControlData.products}
          currentQuarter={inventoryControlData.currentQuarter}
        />
      )}
      {tab === "postventa" && (canManageStoreFeedback || canViewStoreFeedback) && (
        <StoreFeedbackPanel stores={storeFeedbackStores} editable={canManageStoreFeedback} />
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
