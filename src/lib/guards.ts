import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function requireAdminSession() {
  const session = await auth();
  if (!session || session.user.role !== "admin") return null;
  return session;
}

// Admin can always edit a department's finance KPIs; an employee can only if
// they lead that specific department.
export async function canEditDeptKpis(deptId: string) {
  const session = await auth();
  if (!session) return false;
  if (session.user.role === "admin") return true;
  if (session.user.role === "employee" && session.user.deptId === deptId) {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { isLeader: true, leadsDeptId: true },
    });
    return !!user?.isLeader && user.leadsDeptId === deptId;
  }
  return false;
}

// Confirmado 2026-07-28: Recordatorios pasó de "solo el líder crea para su
// equipo" a "cada persona crea los suyos propios" — cualquiera puede crear
// un recordatorio en su propia área (o admin, en cualquiera).
export async function canCreatePersonalReminder(deptId: string) {
  const session = await auth();
  if (!session) return false;
  if (session.user.role === "admin") return true;
  return session.user.role === "employee" && session.user.deptId === deptId;
}

// Gestionar (editar/completar/desactivar/eliminar) un recordatorio puntual:
// admin, o quien lidera esa área (igual que antes, sin perder esa
// capacidad), o quien lo creó — para que cada quien controle lo suyo sin
// depender del líder.
export async function canManagePeriodicReminder(reminder: { deptId: string; createdById: string | null }) {
  const session = await auth();
  if (!session) return false;
  if (session.user.role === "admin") return true;
  if (reminder.createdById === session.user.id) return true;
  return canEditDeptKpis(reminder.deptId);
}

// The weekly review log (admin-leader meeting notes) can be viewed by admin
// or only the employee who leads that specific department — not the rest of
// the team. Only admin can write to it — checked separately at the route
// level with requireAdminSession().
export async function canViewDeptReview(deptId: string) {
  const session = await auth();
  if (!session) return false;
  if (session.user.role === "admin") return true;
  if (session.user.role === "employee" && session.user.deptId === deptId) {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { isLeader: true, leadsDeptId: true },
    });
    return !!user?.isLeader && user.leadsDeptId === deptId;
  }
  return false;
}

// Admin can always write to "Leyes y Reglamentos" (company-wide); an employee
// only if explicitly granted via User.canManageLaws. Neither can delete —
// that stays admin-only, checked separately.
export async function canWriteLaws() {
  const session = await auth();
  if (!session) return false;
  if (session.user.role === "admin") return true;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { canManageLaws: true },
  });
  return !!user?.canManageLaws;
}

// Departments that work directly with suppliers get to browse the approved
// directory. Admin always sees it all.
export const SUPPLIER_VIEW_DEPT_CODES = ["COM", "MKT"];

// Análisis de Mercado is the team that actually sources suppliers, so
// everyone there can propose one — not just whoever was individually granted
// canAddSuppliers. That flag stays as an escape hatch for granting the
// ability to someone outside this department.
export const SUPPLIER_ADD_DEPT_CODES = ["MKT"];

export async function getSupplierAccess() {
  const session = await auth();
  if (!session) return { canView: false, canAdd: false, isLeader: false, leadsDeptId: null as string | null };
  if (session.user.role === "admin") return { canView: true, canAdd: true, isLeader: false, leadsDeptId: null };

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { canAddSuppliers: true, isLeader: true, leadsDeptId: true, department: { select: { code: true } } },
  });
  if (!user) return { canView: false, canAdd: false, isLeader: false, leadsDeptId: null };

  // Directorio access is Compras/Análisis de Mercado (or whoever was granted
  // canAddSuppliers directly) — not every department leader company-wide.
  // A leader still reaches the page via canReview (below) to approve/reject
  // their own team's submissions even if their área can't see the directory.
  const inSupplierDept = !!user.department && SUPPLIER_VIEW_DEPT_CODES.includes(user.department.code);
  const canAddByDept = !!user.department && SUPPLIER_ADD_DEPT_CODES.includes(user.department.code);
  return {
    canView: inSupplierDept || user.canAddSuppliers,
    canAdd: canAddByDept || user.canAddSuppliers,
    isLeader: user.isLeader,
    leadsDeptId: user.leadsDeptId,
  };
}

// A pending supplier can be approved/rejected by admin, or by whoever leads
// the department the submitter belonged to when they proposed it.
export async function canReviewSupplier(createdByDeptId: string | null) {
  const session = await auth();
  if (!session) return false;
  if (session.user.role === "admin") return true;
  if (!createdByDeptId) return false;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isLeader: true, leadsDeptId: true },
  });
  return !!user?.isLeader && user.leadsDeptId === createdByDeptId;
}

// How many Feedback semanal entries the current user (as leader of their
// área) hasn't seen yet — drives the sidebar/tab badges. Admin authors this
// content, so it never has anything "unseen" of its own.
export async function getUnseenFeedbackCount() {
  const session = await auth();
  if (!session || session.user.role !== "employee") return 0;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isLeader: true, leadsDeptId: true, lastSeenFeedbackAt: true },
  });
  if (!user?.isLeader || !user.leadsDeptId) return 0;
  return prisma.weeklyReviewRecord.count({
    where: { deptId: user.leadsDeptId, updatedAt: { gt: user.lastSeenFeedbackAt ?? new Date(0) } },
  });
}

// Only admin or whoever leads Finanzas - Contabilidad can upload/edit pay
// stubs for the whole company — everyone else can only view their own.
export async function canManagePayroll() {
  const session = await auth();
  if (!session) return false;
  if (session.user.role === "admin") return true;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isLeader: true, leadsDept: { select: { code: true } } },
  });
  return !!user?.isLeader && user.leadsDept?.code === "FIN";
}

// Chat interno de Roles de pago — confirmado 2026-07-27: solo el propio
// colaborador o quien de verdad gestiona la nómina (líder de Finanzas, NO
// admin) puede escribirle directo a alguien. El admin ve todo (canView...
// abajo) pero nunca envía — es transparencia, no participación.
export async function canSendPayrollMessage(employeeId: string) {
  const session = await auth();
  if (!session) return false;
  if (session.user.id === employeeId) return true;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isLeader: true, leadsDept: { select: { code: true } } },
  });
  return !!user?.isLeader && user.leadsDept?.code === "FIN";
}

// Igual que canSendPayrollMessage pero el admin también puede VER (nunca
// escribir) cualquier conversación, de cualquier área.
export async function canViewPayrollMessages(employeeId: string) {
  const session = await auth();
  if (!session) return false;
  if (session.user.role === "admin") return true;
  return canSendPayrollMessage(employeeId);
}

// Same rule as canManagePayroll (admin or whoever leads Finanzas), applied to
// KPI de Garantías too — kept as its own function for the same reason.
export async function canManageWarranties() {
  const session = await auth();
  if (!session) return false;
  if (session.user.role === "admin") return true;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isLeader: true, leadsDept: { select: { code: true } } },
  });
  return !!user?.isLeader && user.leadsDept?.code === "FIN";
}

// Same rule as canManagePayroll (admin or whoever leads Finanzas), applied to
// a different indicator — kept as its own function since the two features
// are unrelated even though the permission happens to be identical today.
export async function canManageReturnRate() {
  const session = await auth();
  if (!session) return false;
  if (session.user.role === "admin") return true;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isLeader: true, leadsDept: { select: { code: true } } },
  });
  return !!user?.isLeader && user.leadsDept?.code === "FIN";
}

// Nómina — admin or whoever leads Finanzas - Contabilidad (today Nairoby
// Castro) can create/edit any employee's record company-wide (same
// company-wide-not-just-own-dept scope as Roles de pago). Deleting a user
// stays admin-only — checked separately at the route level with
// requireAdminSession(), never granted here.
export async function canManageNomina() {
  const session = await auth();
  if (!session) return false;
  if (session.user.role === "admin") return true;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isLeader: true, leadsDept: { select: { code: true } } },
  });
  return !!user?.isLeader && user.leadsDept?.code === "FIN";
}

// Ruptura de Stock — admin or whoever leads Inventario (today Daniel Moran).
export async function canManageStockouts() {
  const session = await auth();
  if (!session) return false;
  if (session.user.role === "admin") return true;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isLeader: true, leadsDept: { select: { code: true } } },
  });
  return !!user?.isLeader && user.leadsDept?.code === "INV";
}

// Control de Inventario (KPIs de inventario) — confirmado 2026-08-04: admin,
// o quien lidere Inventario (hoy Daniel Morán), o quien el admin delegue
// puntualmente vía User.canManageInventoryControl (mismo escape hatch que
// canManagePurchases). Esta función gatilla SOLO la pantalla de captura
// ("Control de Inventario" en Mi área de trabajo) — nunca ve las gráficas
// resultantes desde ahí, esas viven en KPIs financieros / Inicio.
export async function canManageInventoryControl() {
  const session = await auth();
  if (!session) return false;
  if (session.user.role === "admin") return true;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isLeader: true, leadsDept: { select: { code: true } }, canManageInventoryControl: true },
  });
  if (user?.canManageInventoryControl) return true;
  return !!user?.isLeader && user.leadsDept?.code === "INV";
}

// KPIs de inventario en Inicio — confirmado 2026-08-04: admin, o quien lidere
// Inventario (Daniel), Análisis de Mercado/ventas (Bryan Ríos) o Finanzas
// (Nairoby Castro) — las 3 personas + el dueño que deben ver esta tarjeta,
// sin importar si Daniel nunca ve las gráficas desde su propia pantalla de
// captura (canManageInventoryControl es independiente de esta).
export async function canViewInventoryKpisHome() {
  const session = await auth();
  if (!session) return false;
  if (session.user.role === "admin") return true;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isLeader: true, leadsDept: { select: { code: true } } },
  });
  const code = user?.leadsDept?.code;
  return !!user?.isLeader && (code === "INV" || code === "MKT" || code === "FIN");
}

// Panel completo de KPIs de inventario (las 4 tarjetas + la tabla de
// productos cargados), no solo la tarjeta resumida de Inicio — confirmado
// 2026-08-05: Daniel (INV) y Bryan (MKT) no tenían dónde ver esto en detalle,
// solo el resumen de Inicio. Nairoby (FIN) y el admin YA lo ven completo vía
// KPIs financieros → Inventario en la página de Finanzas, así que esta
// función NO los incluye — evita duplicar la misma vista en dos pestañas de
// la misma persona. Se agrega como pestaña nueva en "Mi área de trabajo".
export async function canViewInventoryKpisPanel() {
  const session = await auth();
  if (!session || session.user.role === "admin") return false;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isLeader: true, leadsDept: { select: { code: true } } },
  });
  const code = user?.leadsDept?.code;
  return !!user?.isLeader && (code === "INV" || code === "MKT");
}

// Caja Chica Principal — confirmado 2026-08-05: admin, o quien lidere
// Finanzas (hoy Nairoby Castro). Misma persona que ya administra KPIs
// financieros/Nómina para esa área.
export async function canManagePettyCashPrincipal() {
  const session = await auth();
  if (!session) return false;
  if (session.user.role === "admin") return true;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isLeader: true, leadsDept: { select: { code: true } } },
  });
  return !!user?.isLeader && user.leadsDept?.code === "FIN";
}

// Caja Chica Secundaria — confirmado 2026-08-05: admin, o quien el admin
// delegue puntualmente vía User.canManagePettyCashSecundaria (hoy Bryan
// Ríos) — no depende de su departamento real (Análisis de Mercado), mismo
// patrón que canManagePurchases.
export async function canManagePettyCashSecundaria() {
  const session = await auth();
  if (!session) return false;
  if (session.user.role === "admin") return true;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { canManagePettyCashSecundaria: true },
  });
  return !!user?.canManagePettyCashSecundaria;
}

// Ver Caja Chica Principal (sin poder escribir) — confirmado 2026-08-05:
// nunca se delega a nadie más que admin/Nairoby — Bryan NO la ve.
export async function canViewPettyCashPrincipal() {
  return canManagePettyCashPrincipal();
}

// Ver Caja Chica Secundaria (sin poder escribir) — confirmado 2026-08-05:
// quien administra la Principal (Nairoby) también ve la Secundaria, porque
// está "bajo su mando" — además de quien ya la administra (Bryan) y admin.
export async function canViewPettyCashSecundaria() {
  if (await canManagePettyCashSecundaria()) return true;
  return canManagePettyCashPrincipal();
}

// Servicio Postventa (feedback de tiendas) — confirmado 2026-07-25: vive en
// Análisis de Mercado (visible a asesores/líder de venta). Admin, quien lidera
// Análisis de Mercado, o quien el admin delegue puntualmente vía
// User.canManageStoreFeedback, puede log/editar evaluaciones y el catálogo.
export async function canManageStoreFeedback() {
  const session = await auth();
  if (!session) return false;
  if (session.user.role === "admin") return true;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isLeader: true, leadsDept: { select: { code: true } }, canManageStoreFeedback: true },
  });
  if (user?.canManageStoreFeedback) return true;
  return !!user?.isLeader && user.leadsDept?.code === "MKT";
}

// Nivel de acceso separado, solo lectura — confirmado 2026-07-25: para
// líderes de otras áreas (ej. líder de ventas) que deben poder ver el detalle
// y contactar por WhatsApp, pero nunca crear/editar/eliminar. Independiente
// del departamento de la persona (igual que canManageStoreFeedback) — no
// exige que su propio deptId sea MKT, solo que se le haya delegado el flag.
export async function canViewStoreFeedback() {
  if (await canManageStoreFeedback()) return true;
  const session = await auth();
  if (!session) return false;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { canViewStoreFeedback: true },
  });
  return !!user?.canViewStoreFeedback;
}

// Control de Compras — confirmado 2026-07-30: no es "la página de un
// departamento" único, así que cada acción se resuelve por SU dueño natural
// en vez de un solo deptId fijo: Bryan (Compras) y Nairoby (Finanzas) por
// igual SOLICITAN; Daniel (Inventario) CONFIRMA que llegó; Finanzas
// REGISTRA la factura. Admin siempre puede todo. canManagePurchases es un
// escape hatch para delegar a alguien fuera de esos liderazgos sin tocar
// código.
async function purchasesUserContext(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { canManagePurchases: true, isLeader: true, leadsDept: { select: { code: true } } },
  });
}

export async function canSubmitPurchaseRequests() {
  const session = await auth();
  if (!session) return false;
  if (session.user.role === "admin") return true;
  const user = await purchasesUserContext(session.user.id);
  if (!user) return false;
  if (user.canManagePurchases) return true;
  return !!user.isLeader && !!user.leadsDept && ["COM", "FIN"].includes(user.leadsDept.code);
}

// Confirmado 2026-08-06: bug real — canManagePurchases es un escape hatch
// compartido pensado para Solicitar/Facturar (Bryan/Nairoby), pero como esta
// función también lo aceptaba, cualquiera con ese flag heredaba de paso la
// responsabilidad de Daniel de confirmar que la mercadería llegó (y de
// informar urgencias) — algo que el usuario confirmó debe ser EXCLUSIVO del
// líder de Inventario, sin ninguna delegación por flag genérico.
export async function canConfirmPurchaseReceiving() {
  const session = await auth();
  if (!session) return false;
  if (session.user.role === "admin") return true;
  const user = await purchasesUserContext(session.user.id);
  if (!user) return false;
  return !!user.isLeader && user.leadsDept?.code === "INV";
}

// Fix confirmado 2026-08-11: excepción explícita al patrón "admin siempre
// puede" — el usuario pidió específicamente que confirmar que llegó,
// informar urgente, y verificar cambios recibidos sean EXCLUSIVOS del líder
// de Inventario, ni siquiera admin. canConfirmPurchaseReceiving arriba
// sigue igual (se usa para poder VER la pestaña Inventario/GET), pero las
// rutas que de verdad ejecutan la acción usan esta en su lugar.
export async function canActOnPurchaseReceiving() {
  const session = await auth();
  if (!session) return false;
  const user = await purchasesUserContext(session.user.id);
  if (!user) return false;
  return !!user.isLeader && user.leadsDept?.code === "INV";
}

// Fix confirmado 2026-08-07: mismo bug que ya se corrigió en
// canConfirmPurchaseReceiving — canManagePurchases es el escape hatch
// pensado para Solicitar (Bryan), pero como esta función también lo
// aceptaba, Bryan heredaba de paso la pestaña "Finanzas"/Facturación, que es
// exclusiva de Nairoby (líder de Finanzas). Sin delegación por flag genérico.
export async function canRegisterPurchaseInvoices() {
  const session = await auth();
  if (!session) return false;
  if (session.user.role === "admin") return true;
  const user = await purchasesUserContext(session.user.id);
  if (!user) return false;
  return !!user.isLeader && user.leadsDept?.code === "FIN";
}

// Pagos administrativos (Finanzas) — confirmado 2026-08-06: exclusivo de
// Finanzas + admin, a diferencia de Control de Compras que también incluye a
// Compras. canManageAdminPayments es el mismo tipo de escape hatch que
// canManagePurchases, para delegar sin tocar código.
export async function canManageAdminPayments() {
  const session = await auth();
  if (!session) return false;
  if (session.user.role === "admin") return true;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { canManageAdminPayments: true, isLeader: true, leadsDept: { select: { code: true } } },
  });
  if (!user) return false;
  if (user.canManageAdminPayments) return true;
  return !!user.isLeader && user.leadsDept?.code === "FIN";
}

// "Mercadería recibida" (Análisis de Mercado) — confirmado 2026-08-08.
// Ver visible = pertenecer al departamento MKT + admin (Bryan y Andrés
// incluidos, aunque ninguno de los dos confirma nada, solo supervisan).
export async function canViewMarketingArrivals() {
  const session = await auth();
  if (!session) return false;
  if (session.user.role === "admin") return true;
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { department: { select: { code: true } } } });
  return user?.department?.code === "MKT";
}

// Fix confirmado 2026-08-08: excepción explícita al patrón habitual de
// "admin siempre puede" — el usuario (admin/CEO) pidió específicamente que
// los botones de confirmar sean exclusivos de quien tiene el flag (hoy
// Robert/Heidy/Jariel); ni él ni Bryan deben poder confirmar, solo ver.
export async function canConfirmMarketingDesign() {
  const session = await auth();
  if (!session || session.user.role === "admin") return false;
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { canConfirmMarketingDesign: true } });
  return !!user?.canConfirmMarketingDesign;
}

export async function canConfirmMarketingAdvisor() {
  const session = await auth();
  if (!session || session.user.role === "admin") return false;
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { canConfirmMarketingAdvisor: true } });
  return !!user?.canConfirmMarketingAdvisor;
}

// How many of the current user's own pay stubs were uploaded/updated since
// they last opened "Roles de pago" — drives the sidebar badge.
export async function getUnseenPayStubCount() {
  const session = await auth();
  if (!session || session.user.role !== "employee") return 0;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { lastSeenPayStubAt: true },
  });
  if (!user) return 0;
  return prisma.payStub.count({
    where: { userId: session.user.id, updatedAt: { gt: user.lastSeenPayStubAt ?? new Date(0) } },
  });
}

// How many confidential documents were shared with the current user that
// they haven't opened yet — drives the sidebar badge, and whether the nav
// link shows at all (an employee with zero grants never sees the section).
export async function getUnseenConfidentialCount() {
  const session = await auth();
  if (!session || session.user.role !== "employee") return 0;
  return prisma.confidentialDocumentAccess.count({
    where: { userId: session.user.id, seenAt: null },
  });
}

export async function getConfidentialAccessCount() {
  const session = await auth();
  if (!session || session.user.role !== "employee") return 0;
  return prisma.confidentialDocumentAccess.count({ where: { userId: session.user.id } });
}

// Colaborador Destacado del Mes — only admin and department leaders take
// part in evaluating (leaders rate their own team, admin rates leaders), so
// only they get the section in the sidebar at all.
export async function canAccessRecognition() {
  const session = await auth();
  if (!session) return false;
  if (session.user.role === "admin") return true;
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { isLeader: true } });
  return !!user?.isLeader;
}

// Who is allowed to evaluate a specific person this month: admin evaluates
// leaders (and can always override), a leader evaluates their own
// non-leader team members — nobody evaluates admin.
export async function canEvaluateUser(evaluateeId: string) {
  const session = await auth();
  if (!session) return false;

  const evaluatee = await prisma.user.findUnique({
    where: { id: evaluateeId },
    select: { deptId: true, isLeader: true },
  });
  if (!evaluatee) return false;

  if (session.user.role === "admin") return true;
  if (evaluatee.isLeader) return false;

  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isLeader: true, leadsDeptId: true },
  });
  return !!me?.isLeader && me.leadsDeptId === evaluatee.deptId;
}
