import { prisma } from "@/lib/prisma";
import { canManageNomina, canLogOvertimeHours, canConfirmPersonalPurchaseInventory, canViewReturnRateDetailFor } from "@/lib/guards";

// Qué ítems opcionales del menú lateral del colaborador se muestran — lo usa
// area/layout.tsx (lo que se dibuja) y maryHelp.ts (lo que Mary puede
// explicar), para que ambos sigan siempre la misma regla.

// Confirmado 2026-07-22: Servicio Postventa's company-wide average is
// public to every employee, even those with no other KPI edit rights (the
// page itself still gates each individual section's edit UI) — EXCEPT
// confirmado 2026-09-04: pedido explícito del usuario, estas personas no
// deben ver el botón "KPIs Generales" en absoluto.
const KPIS_HIDDEN_USERNAMES = new Set([
  "jarielmurillo2026", // Jariel Murillo
  "robert2026", // Robert Salinas
  "heidy2026", // Heidy Morales
  "joelguale2026", // Joel Guale
  "scott2026", // Bryan Franco (usuario "scott2026")
  "luis2026", // Luis Castillo
  "allan2026", // Allan Anastacio
]);

export type EmployeeSidebarFlags = {
  showKpis: boolean;
  showNomina: boolean;
  showPersonalPurchasesInventory: boolean;
  showMyLearningPath: boolean;
  showConfidential: boolean;
};

export async function getEmployeeSidebarFlags(
  user: { id: string; username: string; isB2BAdvisor: boolean; isLeader: boolean; leadsDeptId: string | null },
  deptCode: string,
): Promise<EmployeeSidebarFlags> {
  // 2026-09-30: además de la lista, quien tenga el rol
  // Asesor(a) B2B (lo que hacía Heidy, que estaba oculta) tampoco ve el botón.
  // Pedido del usuario 2026-10-01: líderes y todo Análisis de Mercado ven el
  // detalle de la Tasa de Devolución en KPIs Generales, así que para ellos
  // el botón aparece aunque estén en la lista de arriba.
  const showKpis = (!KPIS_HIDDEN_USERNAMES.has(user.username) && !user.isB2BAdvisor) || canViewReturnRateDetailFor(user, deptCode);
  // Confirmado 2026-08-13: pedido explícito del usuario — el líder de un
  // área habilitada para horas extra (hoy Inventario y Fulfillment)
  // necesita entrar acá para registrar, aunque no gestione Nómina en
  // general (esa parte de la pantalla queda oculta para él, ver
  // NominaPageTabs).
  const [manageNomina, logOvertime, showPersonalPurchasesInventory, learningPathCount, confidentialAccessCount] = await Promise.all([
    canManageNomina(),
    canLogOvertimeHours(),
    canConfirmPersonalPurchaseInventory(),
    prisma.learningPathAssignment.count({ where: { userId: user.id } }),
    prisma.confidentialDocumentAccess.count({ where: { userId: user.id } }),
  ]);
  return {
    showKpis,
    showNomina: manageNomina || logOvertime,
    showPersonalPurchasesInventory,
    showMyLearningPath: learningPathCount > 0,
    showConfidential: confidentialAccessCount > 0,
  };
}
