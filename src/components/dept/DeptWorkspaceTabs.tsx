"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { GitBranch, FileText, GraduationCap, LineChart, TrendingUp, MessageSquare, CalendarClock, BellRing, Heart, ShoppingCart, Package, Pin, Wallet, BarChart3, Landmark, PackageCheck, PackageOpen, PackageMinus, Truck, HandCoins } from "lucide-react";
import { ProcessEmbeddedPanel } from "@/components/process/ProcessEmbeddedPanel";
import type { ProcessDTO } from "@/components/process/ProcessEditor";
import type { ProcessUpdateDTO } from "@/components/process/ProcessHistoryPanel";
import { PeriodicRemindersPanel } from "@/components/process/PeriodicRemindersPanel";
import type { PeriodicReminderDTO } from "@/lib/periodicReminders";
import { DocumentsPanel } from "@/components/documents/DocumentsPanel";
import { ExamsPanel } from "@/components/exams/ExamsPanel";
import { StoreFeedbackPanel } from "@/components/finance/StoreFeedbackPanel";
import { StoreFeedbackKpiPanel } from "@/components/finance/StoreFeedbackKpiPanel";
import type { StoreDTO, StoreFeedbackAggregate } from "@/lib/storeFeedback";
import { FinanceKpiWorkspace } from "@/components/finance/FinanceKpiWorkspace";
import type { FinanceKpiDataDTO } from "@/lib/financeKpis";
import { PaymentRemindersPanel } from "@/components/finance/PaymentRemindersPanel";
import type { PaymentReminderDTO } from "@/lib/paymentReminders";
import { WeeklyMetricPanel, type WeeklyMetricDTO } from "@/components/fulfillment/WeeklyMetricPanel";
import { WeeklyReviewPanel, type WeeklyReviewDTO, type InvolvingMeReviewDTO } from "@/components/marketanalysis/WeeklyReviewPanel";
import { PurchaseControlPanel } from "@/components/purchases/PurchaseControlPanel";
import { InventoryControlPanel } from "@/components/inventory/InventoryControlPanel";
import { InventoryKpisPanel } from "@/components/finance/InventoryKpisPanel";
import type { InventoryControlPeriodDTO, InventorySnapshotPeriodDTO, InventoryKpisDataDTO } from "@/lib/inventoryKpis";
import { PettyCashPanel } from "@/components/pettycash/PettyCashPanel";
import { PettyCashExceptionsPanel } from "@/components/pettycash/PettyCashExceptionsPanel";
import type { PettyCashViewerData } from "@/lib/pettyCash";
import { AdminPaymentsPanel } from "@/components/finance/AdminPaymentsPanel";
import { MarketingArrivalsPanel } from "@/components/marketing/MarketingArrivalsPanel";
import { MerchandiseReentryPanel } from "@/components/merchandise-reentry/MerchandiseReentryPanel";
import { MerchandiseOutflowPanel } from "@/components/merchandise-outflow/MerchandiseOutflowPanel";
import { ExternalSalesPanel } from "@/components/external-sales/ExternalSalesPanel";
import { SuppliersPanel, type SupplierDTO } from "@/components/suppliers/SuppliersPanel";

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
  { key: "compras", label: "Control de Compras", icon: ShoppingCart },
  { key: "proveedores", label: "Proveedores", icon: Truck },
  { key: "llegadas", label: "Mercadería recibida", icon: PackageCheck },
  { key: "inventario", label: "Control de Inventario", icon: Package },
  { key: "reingreso", label: "Reingreso de Mercadería", icon: PackageOpen },
  { key: "egresos", label: "Registro de Egresos", icon: PackageMinus },
  { key: "ventas-externas", label: "Ventas Externas", icon: HandCoins },
  { key: "inventoriokpis", label: "KPIs de Inventario", icon: BarChart3 },
  { key: "cajachica", label: "Caja Chica", icon: Wallet },
  { key: "pagosadmin", label: "Pagos administrativos", icon: Landmark },
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
  weeklyReviewInvolvingMe = [],
  canManageStoreFeedback = false,
  canViewStoreFeedback = false,
  storeFeedbackStores = [],
  storeFeedbackAggregates = [],
  canSubmitPurchases = false,
  canReceivePurchases = false,
  canReceivePurchasesTeam = false,
  canApprovePurchaseReceiving = false,
  canInvoicePurchases = false,
  canPayMerchandisePurchases = false,
  canAccessSuppliers = false,
  supplierList = [],
  supplierPending = [],
  canAddSupplier = false,
  canAddSupplierCarrier = false,
  canReviewSuppliers = false,
  canAddSupplierBankAccounts = false,
  canManageInventoryControl = false,
  inventoryControlData = null,
  canViewInventoryKpisPanel = false,
  inventoryKpisData = null,
  canCaptureMerchandiseReentry = false,
  canApproveMerchandiseReentry = false,
  canActOnMerchandiseReentry = false,
  canCloseMerchandiseReentry = false,
  canVerifyDamageDisposal = false,
  canManageJustUpload = false,
  canManageJustCatalog = false,
  merchandiseReentryPendingCount = 0,
  canCaptureMerchandiseOutflow = false,
  canActOnMerchandiseOutflow = false,
  canViewMerchandiseOutflow = false,
  supplierExchangeMineCount = 0,
  canConfirmFinanceWriteOff = false,
  financeWriteOffPendingCount = 0,
  canSubmitCancelledGuide = false,
  canConfirmCancelledGuide = false,
  canCutoffCancelledGuide = false,
  canDeclareExternalSales = false,
  canReviewExternalSales = false,
  canConfirmExternalSalePayment = false,
  canCloseExternalSale = false,
  canViewExternalSales = false,
  pettyCashData = null,
  canManageAdminPayments = false,
  canViewMarketingArrivals = false,
  canConfirmMarketingDesign = false,
  canConfirmMarketingAdvisor = false,
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
  weeklyReviewInvolvingMe?: InvolvingMeReviewDTO[];
  // Servicio Postventa (Análisis de Mercado) — per-viewer gate pattern, not
  // a per-department trackXxx flag. Esta data evalúa al líder de MKT, así
  // que solo Nairoby (canManageStoreFeedback) edita. Solo-lectura tiene DOS
  // variantes según quién mira (confirmado 2026-08-26): admin ve el detalle
  // completo por tienda (StoreFeedbackPanel editable={false}) porque lo
  // necesita para evaluar a Bryan; Bryan/otros delegados con
  // canViewStoreFeedback ven solo el agregado mensual (StoreFeedbackKpiPanel,
  // fix 2026-08-11) — nunca el detalle operativo sobre sí mismos.
  canManageStoreFeedback?: boolean;
  canViewStoreFeedback?: boolean;
  storeFeedbackStores?: StoreDTO[];
  storeFeedbackAggregates?: StoreFeedbackAggregate[];
  // Control de Compras — mismo patrón sin dept.code que Servicio Postventa
  // (confirmado 2026-07-30): Bryan y Nairoby están "asignados puntualmente"
  // a esto sin ser líderes formales de Control de Compras como departamento,
  // así que se ve en la propia "Mi área de trabajo" de cada quien sin
  // importar a qué departamento pertenezcan de verdad.
  canSubmitPurchases?: boolean;
  canReceivePurchases?: boolean;
  // Confirmado 2026-08-18: canReceivePurchases sigue siendo el gate de la
  // pestaña "Inventario" (ahora todo el equipo de INV, no solo Daniel);
  // canReceivePurchasesTeam habilita recibir/informar urgente,
  // canApprovePurchaseReceiving habilita la aprobación final (exclusiva de
  // Daniel) — ver PurchaseReceivingPanel.
  canReceivePurchasesTeam?: boolean;
  canApprovePurchaseReceiving?: boolean;
  canInvoicePurchases?: boolean;
  canPayMerchandisePurchases?: boolean;
  // Proveedores — movido de su propio ítem de sidebar a esta pestaña
  // (confirmado 2026-08-21), entre "Control de Compras" y "Documentos".
  // canAccessSuppliers gatea si la pestaña se ve (ver access.canView /
  // access.canAdd / canReview en getSupplierAccess, guards.ts);
  // canAddSupplier/canAddSupplierCarrier/canReviewSuppliers/
  // canAddSupplierBankAccounts controlan qué puede hacer dentro del panel,
  // igual que en la extinta /area/proveedores.
  canAccessSuppliers?: boolean;
  supplierList?: SupplierDTO[];
  supplierPending?: SupplierDTO[];
  canAddSupplier?: boolean;
  canAddSupplierCarrier?: boolean;
  canReviewSuppliers?: boolean;
  canAddSupplierBankAccounts?: boolean;
  // Control de Inventario — mismo patrón sin dept.code que Control de
  // Compras/Servicio Postventa (confirmado 2026-08-04): Daniel lo ve en su
  // propia "Mi área de trabajo" sin importar si su departamento real es INV.
  canManageInventoryControl?: boolean;
  inventoryControlData?: {
    currentPeriod: string;
    periods: InventoryControlPeriodDTO[];
    currentSnapshotPeriod: string;
    snapshotPeriods: InventorySnapshotPeriodDTO[];
  } | null;
  // KPIs de inventario completos (no solo la tarjeta de Inicio) — confirmado
  // 2026-08-05: Daniel (INV) y Bryan (MKT) los ven en su propia "Mi área de
  // trabajo"; Nairoby y admin ya los ven vía KPIs financieros → Inventario,
  // así que esta pestaña no se les agrega ahí para no duplicar la vista.
  canViewInventoryKpisPanel?: boolean;
  inventoryKpisData?: InventoryKpisDataDTO | null;
  // Reingreso de Mercadería — movido a esta pestaña (confirmado 2026-08-21,
  // antes era su propio ítem de sidebar "propio, no anidado"; ahora vive
  // junto a Control de Inventario). Mismos tres roles que
  // `/area/reingreso-mercaderia` (ver guards.ts): captura = equipo INV,
  // aprueba = Daniel (o admin), cierra = Nairoby (o admin).
  canCaptureMerchandiseReentry?: boolean;
  canApproveMerchandiseReentry?: boolean;
  canActOnMerchandiseReentry?: boolean;
  canCloseMerchandiseReentry?: boolean;
  // Verificación física + disposición final en "Control de Daños" —
  // exclusivo de Nairoby (FIN), ni siquiera admin (ver
  // canVerifyDamageDisposal en guards.ts); canCloseMerchandiseReentry
  // sigue dando visibilidad de solo lectura de esas colas.
  canVerifyDamageDisposal?: boolean;
  // Subir a Just ("Cierre") — exclusivo de Nairoby (FIN); admin y Daniel
  // solo ven la pestaña en modo lectura (ver canManageJustUpload en
  // guards.ts, que sigue dando esa visibilidad vía canApprove/canClose).
  canManageJustUpload?: boolean;
  canManageJustCatalog?: boolean;
  merchandiseReentryPendingCount?: number;
  // Registro de Egresos — mismo patrón sin dept.code que Reingreso
  // (confirmado 2026-08-25): captura (despacho/garantía/deterioro) = equipo
  // INV, dar de baja en Just + resolver deterioro = exclusivo de Daniel (o
  // admin en modo lectura).
  canCaptureMerchandiseOutflow?: boolean;
  canActOnMerchandiseOutflow?: boolean;
  canViewMerchandiseOutflow?: boolean;
  // Confirmado 2026-08-27, pedido explícito del usuario: cuántos productos
  // de "Cambio con proveedor" tiene ESTE usuario (no Daniel/admin) pendientes
  // de gestionar como quien pidió la compra original — ver
  // getSupplierExchangeGestorCount en pendingTasks.ts. Amplía la visibilidad
  // de la pestaña "egresos" (y de su sub-pestaña "proveedor") igual que
  // canSubmitCancelledGuide, sin tocar canViewMerchandiseOutflow.
  supplierExchangeMineCount?: number;
  // Confirmado 2026-08-27, pedido explícito del usuario: cuando un proveedor
  // rechaza un cambio, Nairoby (Finanzas) confirma la baja financiera —
  // mismo patrón que supplierExchangeMineCount, amplía la visibilidad de la
  // pestaña "egresos" para ella aunque no tenga ningún otro acceso al módulo.
  canConfirmFinanceWriteOff?: boolean;
  financeWriteOffPendingCount?: number;
  // Guías Canceladas (Fase 4) — vive dentro de la pestaña de Egresos, pero
  // trae gente que no es de Inventario (Bryan/MKT, equipo de FUL), así que
  // amplía la visibilidad de esa pestaña sin tocar canViewMerchandiseOutflow
  // (que sigue gateando las rutas propias de Egresos).
  canSubmitCancelledGuide?: boolean;
  canConfirmCancelledGuide?: boolean;
  canCutoffCancelledGuide?: boolean;
  // Ventas Externas (Fase 3) — declarar/revisión/pagos/cierre viven en la
  // misma pestaña sin dept.code (Bryan revisa, admin confirma pago, Nairoby
  // cierra); despacho/entregas reusan las guards de Registro de Egresos.
  canDeclareExternalSales?: boolean;
  canReviewExternalSales?: boolean;
  canConfirmExternalSalePayment?: boolean;
  canCloseExternalSale?: boolean;
  canViewExternalSales?: boolean;
  // Caja Chica — confirmado 2026-08-05: null si la persona no ve ninguna de
  // las dos cajas (ni Principal ni Secundaria le corresponde).
  pettyCashData?: PettyCashViewerData | null;
  // Pagos administrativos — mismo patrón sin dept.code que Control de
  // Compras (confirmado 2026-08-06), exclusivo de Finanzas + admin.
  canManageAdminPayments?: boolean;
  // "Mercadería recibida" — confirmado 2026-08-08: visible para TODOS los
  // que pertenecen a Análisis de Mercado (informativo), pero solo confirman
  // quien tenga el flag puntual (canConfirmMarketingDesign/Advisor) — nunca
  // el líder del área, que solo supervisa.
  canViewMarketingArrivals?: boolean;
  canConfirmMarketingDesign?: boolean;
  canConfirmMarketingAdvisor?: boolean;
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
    if (t.key === "compras") return canSubmitPurchases || canReceivePurchases || canInvoicePurchases;
    if (t.key === "proveedores") return canAccessSuppliers;
    if (t.key === "llegadas") return canViewMarketingArrivals;
    if (t.key === "inventario") return canManageInventoryControl;
    if (t.key === "reingreso") return canCaptureMerchandiseReentry || canApproveMerchandiseReentry || canCloseMerchandiseReentry;
    if (t.key === "egresos") return canViewMerchandiseOutflow || canSubmitCancelledGuide || canConfirmCancelledGuide || canCutoffCancelledGuide || supplierExchangeMineCount > 0 || financeWriteOffPendingCount > 0;
    if (t.key === "ventas-externas") return canViewExternalSales;
    if (t.key === "inventoriokpis") return canViewInventoryKpisPanel;
    if (t.key === "cajachica") return !!(pettyCashData?.principal || pettyCashData?.secundaria);
    if (t.key === "postventa") return canManageStoreFeedback || canViewStoreFeedback;
    if (t.key === "pagosadmin") return canManageAdminPayments;
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
  const [focusBox, setFocusBox] = useState<string | null>(null);

  // Confirmado 2026-08-06: los links "Ir →" de Pendientes (ej. "Caja Chica
  // Secundaria con saldo bajo") llegan con ?tab=...&box=... — esto los honra
  // una sola vez al montar, sin pisar la pestaña fijada si no viene el
  // parámetro. Se lee del URL directo (no useSearchParams) para no requerir
  // un límite de Suspense en cada página que renderiza este componente.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get("tab");
    const boxParam = params.get("box");
    if (tabParam && tabs.some((t) => t.key === tabParam)) setTab(tabParam as TabKey);
    if (boxParam) setFocusBox(boxParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      {/* Fix confirmado 2026-08-11: con overflow-x-auto solo, una pestaña
          fuera del ancho visible quedaba invisible sin ningún indicio de que
          había más (le pasó a Bryan con "Caja Chica") — flex-wrap garantiza
          que TODAS las pestañas queden siempre a la vista, aunque ocupen más
          de una línea. */}
      <div className="flex flex-wrap gap-x-5.5 gap-y-2 border-b border-rule mb-5.5">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`pb-2.5 text-[13px] font-semibold flex items-center gap-1.5 border-b-2 cursor-pointer whitespace-nowrap ${
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
            {t.key === "reingreso" && merchandiseReentryPendingCount > 0 && (
              <span className="font-mono text-[10px] font-semibold bg-red/20 text-red rounded-full px-1.5 py-0.5">
                {merchandiseReentryPendingCount}
              </span>
            )}
            {t.key === "egresos" && supplierExchangeMineCount + financeWriteOffPendingCount > 0 && (
              <span className="font-mono text-[10px] font-semibold bg-red/20 text-red rounded-full px-1.5 py-0.5">
                {supplierExchangeMineCount + financeWriteOffPendingCount}
              </span>
            )}
            {t.key === "proveedores" && canReviewSuppliers && supplierPending.length > 0 && (
              <span className="font-mono text-[10px] font-semibold bg-red/20 text-red rounded-full px-1.5 py-0.5">
                {supplierPending.length}
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
      {tab === "compras" && (canSubmitPurchases || canReceivePurchases || canInvoicePurchases) && (
        <PurchaseControlPanel
          deptId={deptId}
          canSubmit={canSubmitPurchases}
          canReview={isAdmin}
          canReceive={canReceivePurchases}
          canReceiveTeam={canReceivePurchasesTeam}
          canApproveReceiving={canApprovePurchaseReceiving}
          canInvoice={canInvoicePurchases}
          canPayMerchandise={canPayMerchandisePurchases}
          isAdmin={isAdmin}
        />
      )}
      {tab === "proveedores" && canAccessSuppliers && (
        <SuppliersPanel
          suppliers={supplierList}
          pending={supplierPending}
          canAdd={canAddSupplier}
          canAddCarrier={canAddSupplierCarrier}
          canReview={canReviewSuppliers}
          isAdmin={isAdmin}
          canAddBankAccounts={canAddSupplierBankAccounts}
        />
      )}
      {tab === "llegadas" && canViewMarketingArrivals && (
        <MarketingArrivalsPanel canConfirmDesign={canConfirmMarketingDesign} canConfirmAdvisor={canConfirmMarketingAdvisor} />
      )}
      {tab === "inventario" && canManageInventoryControl && inventoryControlData && (
        <InventoryControlPanel
          currentPeriodDefault={inventoryControlData.currentPeriod}
          periods={inventoryControlData.periods}
          currentSnapshotPeriodDefault={inventoryControlData.currentSnapshotPeriod}
          snapshotPeriods={inventoryControlData.snapshotPeriods}
        />
      )}
      {tab === "reingreso" && (canCaptureMerchandiseReentry || canApproveMerchandiseReentry || canCloseMerchandiseReentry) && (
        <MerchandiseReentryPanel
          canCapture={canCaptureMerchandiseReentry}
          canApprove={canApproveMerchandiseReentry}
          canAct={canActOnMerchandiseReentry}
          canClose={canCloseMerchandiseReentry}
          canVerifyDamageDisposal={canVerifyDamageDisposal}
          canManageJustUpload={canManageJustUpload}
          canManageJustCatalog={canManageJustCatalog}
        />
      )}
      {tab === "egresos" && (canViewMerchandiseOutflow || canSubmitCancelledGuide || canConfirmCancelledGuide || canCutoffCancelledGuide) && (
        <MerchandiseOutflowPanel
          canCapture={canCaptureMerchandiseOutflow}
          canAct={canActOnMerchandiseOutflow}
          canView={canViewMerchandiseOutflow}
          canManageJustCatalog={canManageJustCatalog}
          canViewSupplierExchangeResolution={isAdmin || canActOnMerchandiseOutflow}
          supplierExchangeMineCount={supplierExchangeMineCount}
          canConfirmFinanceWriteOff={canConfirmFinanceWriteOff}
          financeWriteOffPendingCount={financeWriteOffPendingCount}
          canSubmitCancelledGuide={canSubmitCancelledGuide}
          canConfirmCancelledGuide={canConfirmCancelledGuide}
          canCutoffCancelledGuide={canCutoffCancelledGuide}
          isAdmin={isAdmin}
        />
      )}
      {tab === "ventas-externas" && canViewExternalSales && (
        <ExternalSalesPanel
          canDeclare={canDeclareExternalSales}
          canReview={canReviewExternalSales}
          canConfirmPayment={canConfirmExternalSalePayment}
          canAssignDispatch={canActOnMerchandiseOutflow}
          canDeliver={canCaptureMerchandiseOutflow}
          canClose={canCloseExternalSale}
        />
      )}
      {tab === "inventoriokpis" && canViewInventoryKpisPanel && inventoryKpisData && (
        <InventoryKpisPanel data={inventoryKpisData} />
      )}
      {tab === "cajachica" && pettyCashData && (pettyCashData.principal || pettyCashData.secundaria) && (
        <div>
          {isAdmin && pettyCashData.pendingExceptions.length > 0 && (
            <PettyCashExceptionsPanel exceptions={pettyCashData.pendingExceptions} />
          )}
          <PettyCashPanel
            principal={pettyCashData.principal}
            secundaria={pettyCashData.secundaria}
            canManagePrincipal={pettyCashData.canManagePrincipal}
            canManageSecundaria={pettyCashData.canManageSecundaria}
            canFundPrincipal={pettyCashData.canFundPrincipal}
            canFundSecundaria={pettyCashData.canFundSecundaria}
            eligibleOrders={pettyCashData.eligibleOrders}
            isAdmin={isAdmin}
            focusBox={focusBox}
          />
        </div>
      )}

      {tab === "pagosadmin" && canManageAdminPayments && <AdminPaymentsPanel isAdmin={isAdmin} />}
      {tab === "postventa" && canManageStoreFeedback && (
        <StoreFeedbackPanel stores={storeFeedbackStores} editable />
      )}
      {tab === "postventa" && !canManageStoreFeedback && canViewStoreFeedback && isAdmin && (
        <StoreFeedbackPanel stores={storeFeedbackStores} editable={false} />
      )}
      {tab === "postventa" && !canManageStoreFeedback && canViewStoreFeedback && !isAdmin && (
        <StoreFeedbackKpiPanel aggregates={storeFeedbackAggregates} />
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
        <WeeklyReviewPanel
          deptId={deptId}
          records={weeklyReviewRecords}
          editable={editable}
          canChangeStatus={kpisEditable ?? editable}
          involvingMe={weeklyReviewInvolvingMe}
        />
      )}
    </div>
  );
}
