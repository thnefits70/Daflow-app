import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// El login de admin (auth.ts, mode: "admin") no está atado a ninguna fila
// real de User — devuelve el id literal "admin", que nunca existe en la
// tabla User. Cualquier createdById/reportedById/etc. que guarde
// session.user.id tal cual revienta con "foreign key constraint violated" en
// cuanto lo usa admin (confirmado 2026-09-02, causa real de "no se pudo
// guardar" en ATOM y en "avisar producto faltante" — ver memoria). Usar esto
// en vez de session.user.id crudo en cualquier campo que sea una relación
// real a User; el campo debe aceptar null (si no, no se puede grabar quién
// hizo la acción cuando la hace admin, sin migrar el schema).
export function dbUserId(id: string): string | null {
  return id === "admin" ? null : id;
}

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

// Datos bancarios de proveedores — confirmado 2026-08-17: pedido explícito
// del usuario, exclusivo de él (admin), nadie más los ve por ahora.
export async function canViewSupplierBankAccounts() {
  const session = await auth();
  return !!session && session.user.role === "admin";
}

// Confirmado 2026-08-18: pedido explícito del usuario — llegó el momento de
// delegar (hoy Jariel y Bryan), pero solo para AGREGAR una cuenta bancaria
// nueva, nunca para ver las ya registradas de otros proveedores (eso sigue
// siendo canViewSupplierBankAccounts, admin-only). Mismo patrón de escape
// hatch por flag que canManagePurchases.
export async function canAddSupplierBankAccounts() {
  const session = await auth();
  if (!session) return false;
  if (session.user.role === "admin") return true;
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { canAddSupplierBankAccounts: true } });
  return !!user?.canAddSupplierBankAccounts;
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

// Confirmado 2026-08-13: pedido explícito del usuario — la calculadora de
// roles de pago (sueldo real, horas extra, bonos, descuentos) es distinta
// del resto del sistema: el admin NUNCA edita, solo ve — a diferencia de
// TODOS los demás canManageX de este archivo, donde admin siempre puede.
// Por eso NO reusa canManagePayroll (que sí le da edición al admin) — hoy
// resuelve a Nairoby Castro (líder de Finanzas), pero sigue el mismo
// criterio por rol que el resto del sistema, no su identidad puntual.
export async function canEditPayrollRoles() {
  const session = await auth();
  if (!session) return false;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isLeader: true, leadsDept: { select: { code: true } } },
  });
  return !!user?.isLeader && user.leadsDept?.code === "FIN";
}

// Admin ve exactamente lo mismo que Nairoby, pero de solo lectura — cada
// ruta de escritura debe seguir usando canEditPayrollRoles() aparte, nunca
// esta función, para no dejar editar al admin sin querer.
export async function canViewPayrollRoles() {
  const session = await auth();
  if (!session) return false;
  if (session.user.role === "admin") return true;
  return canEditPayrollRoles();
}

// Confirmado 2026-08-13: solo el propio líder de un área habilitada
// (interruptor PayrollProfile.canLogOvertimeHours en su propio perfil) ve
// la pantalla de registrar horas extra — carga las suyas y las de su
// equipo. Hoy solo Inventario y Fulfillment lo tienen prendido.
export async function canLogOvertimeHours() {
  const session = await auth();
  if (!session) return false;
  if (session.user.role === "admin") return false;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isLeader: true, payrollProfile: { select: { canLogOvertimeHours: true } } },
  });
  return !!user?.isLeader && !!user.payrollProfile?.canLogOvertimeHours;
}

// Confirmado 2026-08-13: pedido explícito del usuario — sin la aprobación
// del admin, día por día, ninguna hora extra cuenta para el cálculo
// mensual. Exclusivo del admin, nadie más.
export async function canApproveOvertimeHours() {
  const session = await auth();
  return !!session && session.user.role === "admin";
}

// Confirmado 2026-08-14: Nairoby propone los montos de comisión de equipo
// (mismo criterio que canEditPayrollRoles — líder de FIN), el admin
// también puede tocarlos directo. La APROBACIÓN es otra función aparte,
// exclusiva del admin — ver canApproveCommissionAmounts abajo.
export async function canProposeCommissionAmounts() {
  const session = await auth();
  if (!session) return false;
  if (session.user.role === "admin") return true;
  return canEditPayrollRoles();
}

// Confirmado 2026-08-14: pedido explícito del usuario — para evitar que
// Nairoby infle un monto a alguien, ningún cambio queda activo hasta que
// el admin lo apruebe. Exclusivo del admin, sin excepción (nunca
// auto-aprobación, a diferencia de otros guards de este archivo).
export async function canApproveCommissionAmounts() {
  const session = await auth();
  return !!session && session.user.role === "admin";
}

// Cambiar los rangos/nombres de los 3 niveles es estructural (afecta a
// todo el equipo a la vez) — exclusivo del admin, ni siquiera Nairoby.
export async function canManageCommissionTiers() {
  const session = await auth();
  return !!session && session.user.role === "admin";
}

// Confirmado 2026-08-17: mismo criterio que canProposeCommissionAmounts —
// Nairoby (líder de FIN) o admin proponen el bono fijo mensual por
// persona.
export async function canProposeFixedMonthlyBonus() {
  const session = await auth();
  if (!session) return false;
  if (session.user.role === "admin") return true;
  return canEditPayrollRoles();
}

// Confirmado 2026-08-17: pedido explícito del usuario — el bono fijo
// mensual queda inactivo hasta que el admin lo aprueba, exclusivo del
// admin, mismo criterio que canApproveCommissionAmounts.
export async function canApproveFixedMonthlyBonus() {
  const session = await auth();
  return !!session && session.user.role === "admin";
}

// Confirmado 2026-08-18: la confirmación de Daniel (Inventario) es lo que
// habilita el retiro físico de una compra personal — mismo criterio que ya
// gatea su pantalla de "Control de Inventario".
export async function canConfirmPersonalPurchaseInventory() {
  return canManageInventoryControl();
}

// La confirmación de precio final (Nairoby o admin) es lo que activa el
// descuento real en el rol — mismo criterio que canEditPayrollRoles.
export async function canConfirmPersonalPurchaseFinance() {
  const session = await auth();
  if (!session) return false;
  if (session.user.role === "admin") return true;
  return canEditPayrollRoles();
}

// Confirmado 2026-08-20: pedido explícito del usuario — poner el precio de
// una compra personal es exclusivo de Nairoby/FIN, sin bypass de admin (a
// diferencia de canConfirmPersonalPurchaseFinance, que sigue usándose tal
// cual para lo demás del flujo: ver la cola, rechazar, acceso a la
// pestaña). El admin puede ver la cola de precios, pero no editarla.
export async function canSetPersonalPurchasePrice() {
  const session = await auth();
  if (!session) return false;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isLeader: true, leadsDept: { select: { code: true } } },
  });
  return !!user?.isLeader && user.leadsDept?.code === "FIN";
}

// Confirmado 2026-08-20: confirmar que una transferencia de compra personal
// realmente llegó exige revisar la cuenta bancaria real de la empresa —
// exclusivo del admin, sin delegación, mismo espíritu que el paso
// PENDING_PAYMENT→PAID de Pagos administrativos (solo quien ve el banco de
// verdad puede confirmarlo).
export async function canConfirmPersonalPurchaseTransfer() {
  const session = await auth();
  return !!session && session.user.role === "admin";
}

// Confirmado 2026-08-20: pedido explícito del usuario — el cierre final de
// una transferencia (una vez que el admin ya confirmó que la plata llegó)
// es exclusivo de Nairoby/FIN. A diferencia del resto del flujo, acá el
// admin NO tiene bypass — puede ver la cola, pero no cerrarla ni gestionar
// nada ahí. Mismo criterio sin admin que canEditPayrollRoles.
export async function canClosePersonalPurchaseTransfer() {
  const session = await auth();
  if (!session) return false;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isLeader: true, leadsDept: { select: { code: true } } },
  });
  return !!user?.isLeader && user.leadsDept?.code === "FIN";
}

// Anticipos y descuentos por mala gestión — solo el admin los aprueba/crea,
// sin excepción (pedido explícito del usuario).
export async function canManageSalaryAdvances() {
  const session = await auth();
  return !!session && session.user.role === "admin";
}

export async function canCreateManagementDeduction() {
  const session = await auth();
  return !!session && session.user.role === "admin";
}

// Bonos discrecionales del CEO — solo el admin los otorga, siempre.
export async function canGrantCeoBonus() {
  const session = await auth();
  return !!session && session.user.role === "admin";
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

// Servicio Postventa (feedback de tiendas) — esta data sirve para evaluar al
// líder de Análisis de Mercado (Bryan), así que solo puede editarla quien el
// admin delegue puntualmente vía User.canManageStoreFeedback (hoy: solo
// Nairoby). Confirmado 2026-08-26: ni admin ni el liderazgo de MKT tienen
// manage automático — ambos quedan en solo-lectura (canViewStoreFeedback).
export async function canManageStoreFeedback() {
  const session = await auth();
  if (!session) return false;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { canManageStoreFeedback: true },
  });
  return !!user?.canManageStoreFeedback;
}

// Nivel de acceso separado, solo lectura — para admin (necesita ver el
// detalle completo para evaluar a Bryan) y para líderes de otras áreas
// delegados puntualmente (ej. Bryan mismo, que ve solo el agregado — ver
// DeptWorkspaceTabs), pero nunca crear/editar/eliminar.
export async function canViewStoreFeedback() {
  const session = await auth();
  if (!session) return false;
  if (session.user.role === "admin") return true;
  if (await canManageStoreFeedback()) return true;
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
    // department (a diferencia de leadsDept, que es lo que la persona
    // LIDERA) se agregó 2026-08-18 para reconocer al resto del equipo de
    // Inventario, no solo a Daniel (su líder). purchasingNewRequestsBlocked
    // y canApprovePurchaseRequests se agregaron 2026-09-02 para la
    // transición Bryan → Jariel (ver canCreateNewPurchaseRequests y
    // canApprovePurchaseRequests más abajo).
    select: {
      canManagePurchases: true,
      isLeader: true,
      leadsDept: { select: { code: true } },
      department: { select: { code: true } },
      purchasingNewRequestsBlocked: true,
      canApprovePurchaseRequests: true,
    },
  });
}

function isInventoryTeamMember(user: { isLeader: boolean; leadsDept: { code: string } | null; department: { code: string } | null }) {
  return (user.isLeader && user.leadsDept?.code === "INV") || user.department?.code === "INV";
}

function isFulfilmentTeamMember(user: { isLeader: boolean; leadsDept: { code: string } | null; department: { code: string } | null }) {
  return (user.isLeader && user.leadsDept?.code === "FUL") || user.department?.code === "FUL";
}

// Confirmado 2026-09-02: pedido explícito del usuario — alguien en
// transición (purchasingNewRequestsBlocked, hoy Bryan) no debe conservar
// "Mis solicitudes" para siempre. Una vez que ya no le queda ninguna
// solicitud propia sin cerrar (todo llegó a RECIBIDO), pierde el acceso
// automáticamente — nadie tiene que acordarse de apagarle nada a mano. Un
// REJECTED sin reenviar cuenta como "todavía sin cerrar" a propósito:
// mientras esa fila exista, sigue siendo algo suyo por resolver.
async function hasOpenOwnPurchaseRequests(userId: string): Promise<boolean> {
  const count = await prisma.purchaseRequest.count({
    where: { requestedById: userId, status: { not: "RECEIVED" } },
  });
  return count > 0;
}

export async function canSubmitPurchaseRequests() {
  const session = await auth();
  if (!session) return false;
  if (session.user.role === "admin") return true;
  const user = await purchasesUserContext(session.user.id);
  if (!user) return false;
  if (user.canManagePurchases) {
    if (user.purchasingNewRequestsBlocked) return hasOpenOwnPurchaseRequests(session.user.id);
    return true;
  }
  return !!user.isLeader && !!user.leadsDept && ["COM", "FIN"].includes(user.leadsDept.code);
}

// Confirmado 2026-09-02: pedido explícito del usuario — transición Bryan →
// Jariel en Control de Compras. Mismo criterio que canSubmitPurchaseRequests
// de arriba, pero además bloquea a quien tenga purchasingNewRequestsBlocked
// (hoy Bryan) — sigue viendo y resolviendo todo lo que ya tiene en "Mis
// solicitudes" (esas rutas siguen usando canSubmitPurchaseRequests() sin
// cambios), pero ya no puede armar una solicitud nueva desde cero. Se usa
// SOLO en la pestaña "Solicitar" y en el POST que crea una solicitud.
export async function canCreateNewPurchaseRequests() {
  const session = await auth();
  if (!session) return false;
  if (session.user.role === "admin") return true;
  const user = await purchasesUserContext(session.user.id);
  if (!user) return false;
  if (user.purchasingNewRequestsBlocked) return false;
  if (user.canManagePurchases) return true;
  return !!user.isLeader && !!user.leadsDept && ["COM", "FIN"].includes(user.leadsDept.code);
}

// Confirmado 2026-09-03: pedido explícito del usuario — respaldo para
// cuando Jariel (y Nairoby) no están disponibles para solicitar ese día.
// Exclusiva de quien esté en la misma transición que Bryan
// (purchasingNewRequestsBlocked) — siempre visible, no depende de que el
// admin la habilite a mano. La solicitud que se crea por esta vía queda
// marcada isEmergency y solo el admin puede aprobarla/pagarla (nunca la
// misma persona que la subió) — ver review/route.ts y la vista "approval"
// en GET /api/purchase-requests.
export async function canSubmitEmergencyPurchaseRequest() {
  const session = await auth();
  if (!session) return false;
  if (session.user.role === "admin") return false;
  const user = await purchasesUserContext(session.user.id);
  if (!user) return false;
  return !!user.canManagePurchases && !!user.purchasingNewRequestsBlocked;
}

// Confirmado 2026-09-02: pedido explícito del usuario — paso nuevo de
// aprobación con un clic delegado a alguien que no es admin (hoy Bryan, que
// deja de solicitar y pasa a aprobar lo que solicite Jariel). Admin sigue
// pudiendo aprobar también — este flag se SUMA, no lo reemplaza, para que
// quede un respaldo si Bryan no está disponible.
export async function canApprovePurchaseRequests() {
  const session = await auth();
  if (!session) return false;
  if (session.user.role === "admin") return true;
  const user = await purchasesUserContext(session.user.id);
  return !!user?.canApprovePurchaseRequests;
}

// Confirmado 2026-09-02: pedido explícito del usuario — corrección al
// diseño anterior ("admin también puede aprobar, como respaldo"). Aprobar o
// rechazar de VERDAD (el clic que mueve el estado) pasa a ser EXCLUSIVO de
// quien tenga el flag (hoy Bryan), ni siquiera admin — mismo patrón que
// canActOnPurchaseInvoices/canActOnPurchaseReceiving. Admin sigue viendo la
// Bandeja de aprobación (canApprovePurchaseRequests arriba sigue dando esa
// visibilidad) pero en modo SOLO LECTURA: su parte activa en la compra es
// pagar (Finanzas), no aprobar.
export async function canActOnPurchaseApproval() {
  const session = await auth();
  if (!session) return false;
  const user = await purchasesUserContext(session.user.id);
  return !!user?.canApprovePurchaseRequests;
}

// Confirmado 2026-09-02: usado para avisarle por push a quien tenga el
// nuevo flag de aprobación (hoy Bryan) apenas entra una solicitud nueva —
// mismo estilo que getInventoryLeadId/getFulfilmentLeadId.
export async function getPurchaseApproverIds(): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { canApprovePurchaseRequests: true, isActive: true },
    select: { id: true },
  });
  return users.map((u) => u.id);
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
  return isInventoryTeamMember(user);
}

// Confirmado 2026-08-18: pedido explícito del usuario — la recepción física
// (foto+video) y "Informar urgente" dejan de ser exclusivos de Daniel y se
// abren a cualquiera cuyo departamento sea Inventario (no una lista de
// personas ni un flag delegado nuevo). Sigue excluyendo a admin, mismo
// criterio que canActOnPurchaseReceiving — la aprobación FINAL (ver esa
// función más abajo) sigue siendo exclusiva del líder.
// Corrección 2026-08-27: pedido explícito del usuario — Daniel (el líder) NO
// recibe mercadería físicamente, solo su equipo. La intención original era
// chequear solo user.department (a diferencia de isInventoryTeamMember, que
// sí incluye al líder) asumiendo que un líder no tendría su propio
// department también en INV — pero en los datos reales Daniel SÍ tiene
// department=INV además de leadsDept=INV (es su departamento real, se usa
// en nómina/organigrama/etc., no se le puede quitar sin romper eso otro).
// Corrección 2026-08-28: se excluye al líder de forma explícita en vez de
// depender de esa asunción sobre los datos.
export async function canReceivePurchasesTeam() {
  const session = await auth();
  if (!session) return false;
  const user = await purchasesUserContext(session.user.id);
  if (!user) return false;
  if (user.isLeader && user.leadsDept?.code === "INV") return false;
  return user.department?.code === "INV";
}

// Confirmado 2026-08-18: id de Daniel (líder de Inventario) para avisarle
// puntualmente cuando su equipo sube algo pendiente de su aprobación —
// mismo estilo que getMarketingArrivalActorIds en marketingArrivals.ts.
export async function getInventoryLeadId(): Promise<string | null> {
  const lead = await prisma.user.findFirst({
    where: { isLeader: true, leadsDept: { code: "INV" }, isActive: true },
    select: { id: true },
  });
  return lead?.id ?? null;
}

// Yair — líder de Fulfilment, además de asesor de Ventas Externas.
export async function getFulfilmentLeadId(): Promise<string | null> {
  const lead = await prisma.user.findFirst({
    where: { isLeader: true, leadsDept: { code: "FUL" }, isActive: true },
    select: { id: true },
  });
  return lead?.id ?? null;
}

// Confirmado 2026-08-31: pedido explícito del usuario — la justificación
// del Fill Rate bajo es EXCLUSIVA del líder de Fulfillment (hoy Yair), a
// diferencia del resto de KPIs departamentales (canEditDeptKpis, que
// también deja pasar a admin). El admin la ve igual que el resto del
// equipo: solo lectura, sin el botón de publicar — él la lee, no la
// escribe, porque el compromiso es del líder con su equipo.
export async function canJustifyFillRate() {
  const session = await auth();
  if (!session || session.user.role !== "employee") return false;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isLeader: true, leadsDept: { select: { code: true } } },
  });
  return !!user?.isLeader && user.leadsDept?.code === "FUL";
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

// Fix confirmado 2026-08-24: mismo patrón que canActOnPurchaseReceiving —
// admin puede VER la pestaña Finanzas (canRegisterPurchaseInvoices arriba
// sigue igual, se usa en las rutas GET/vista), pero registrar factura,
// marcar como pagado, pagar flete y marcar para revisar es EXCLUSIVO de
// Nairoby (líder de Finanzas), ni siquiera admin — el usuario reportó que
// esa pantalla le salía editable siendo admin cuando debería verse bloqueada
// en modo lectura.
export async function canActOnPurchaseInvoices() {
  const session = await auth();
  if (!session) return false;
  const user = await purchasesUserContext(session.user.id);
  if (!user) return false;
  return !!user.isLeader && user.leadsDept?.code === "FIN";
}

// Fix confirmado 2026-08-25: pedido explícito del usuario — quien de
// verdad transfiere la plata a mercadería es admin (Bryan solo solicita
// desde Compras), así que admin debe poder cerrar/pagar esas solicitudes
// él mismo, a diferencia de registrar factura, pagar flete y marcar para
// revisar, que siguen exclusivos de Nairoby (canActOnPurchaseInvoices
// arriba, sin cambios) — por eso es una función aparte y no un ajuste a
// esa.
export async function canPayMerchandisePurchases() {
  const session = await auth();
  if (!session) return false;
  if (session.user.role === "admin") return true;
  const user = await purchasesUserContext(session.user.id);
  if (!user) return false;
  return !!user.isLeader && user.leadsDept?.code === "FIN";
}

/**
 * ---------------- Reingreso de Mercadería ----------------
 * Diseñado y aprobado 2026-08-19. Tres roles, mismo espíritu que Control de
 * Compras: cualquiera del equipo de Inventario captura (mismo criterio que
 * canReceivePurchasesTeam — sin caso especial para admin, una cuenta admin
 * no tiene departamento real así que naturalmente no calza), solo el líder
 * de Inventario (Daniel) aprueba, y solo el líder de Finanzas (Nairoby)
 * cierra el ciclo — admin sí puede aprobar/cerrar como supervisión general,
 * igual que canRegisterPurchaseInvoices.
 */
export async function canCaptureMerchandiseReentry() {
  const session = await auth();
  if (!session) return false;
  const user = await purchasesUserContext(session.user.id);
  if (!user) return false;
  return isInventoryTeamMember(user);
}

export async function canApproveMerchandiseReentry() {
  const session = await auth();
  if (!session) return false;
  if (session.user.role === "admin") return true;
  const user = await purchasesUserContext(session.user.id);
  if (!user) return false;
  return !!user.isLeader && user.leadsDept?.code === "INV";
}

// Fix confirmado 2026-08-21: mismo patrón que canActOnPurchaseReceiving —
// admin puede VER la pestaña "Revisión" (canApproveMerchandiseReentry
// arriba sigue igual, se usa para eso), pero aprobar lotes, corregir
// nombre+aprobar, y resolver daño son EXCLUSIVOS del líder de Inventario
// (Daniel), ni siquiera admin. Las rutas que ejecutan la acción usan esta
// en su lugar.
export async function canActOnMerchandiseReentry() {
  const session = await auth();
  if (!session) return false;
  const user = await purchasesUserContext(session.user.id);
  if (!user) return false;
  return !!user.isLeader && user.leadsDept?.code === "INV";
}

export async function canCloseMerchandiseReentry() {
  const session = await auth();
  if (!session) return false;
  if (session.user.role === "admin") return true;
  const user = await purchasesUserContext(session.user.id);
  if (!user) return false;
  return !!user.isLeader && user.leadsDept?.code === "FIN";
}

// Verificación física + confirmar baja + disposición final ("Control de
// Daños" → "Pendiente de tu verificación" / "Pendiente de disposición
// final") — exclusivo de Nairoby (líder de FIN), ni siquiera admin. Pedido
// 2026-08-24: admin veía y podía accionar estas dos colas por el bypass de
// canCloseMerchandiseReentry; ahora admin solo las ve en modo lectura
// (canCloseMerchandiseReentry sigue dando esa visibilidad — ver
// WeeklyDamageControl.tsx).
export async function canVerifyDamageDisposal() {
  const session = await auth();
  if (!session) return false;
  const user = await purchasesUserContext(session.user.id);
  if (!user) return false;
  return !!user.isLeader && user.leadsDept?.code === "FIN";
}

// Subir a Just ("Cierre" → Para ingresar a Just) — exclusivo de Nairoby
// (líder de FIN). Revertido 2026-08-24: se había ampliado a Daniel (INV)
// el mismo día, pero el usuario pidió bloquearlo de nuevo — Daniel ve la
// pestaña "Cierre" en modo solo lectura, igual que admin (ver
// canCloseMerchandiseReentry, que sigue dando visibilidad sin el botón de
// acción — ver CloseQueues.tsx).
export async function canManageJustUpload() {
  const session = await auth();
  if (!session) return false;
  const user = await purchasesUserContext(session.user.id);
  if (!user) return false;
  return !!user.isLeader && user.leadsDept?.code === "FIN";
}

// Confirmado 2026-08-21, ampliado 2026-08-23: Daniel (líder de Inventario)
// y admin pueden subir el export de Just que alimenta la Base de datos de
// productos. Originalmente era exclusivo de Daniel ("ni siquiera admin",
// mismo criterio que canActOnMerchandiseReentry) pero el usuario pidió
// tener también acceso propio para subirlo cuando Daniel no pueda.
export async function canManageJustCatalog() {
  const session = await auth();
  if (!session) return false;
  if (session.user.role === "admin") return true;
  const user = await purchasesUserContext(session.user.id);
  if (!user) return false;
  return !!user.isLeader && user.leadsDept?.code === "INV";
}

// Visibilidad general del módulo (ítem del sidebar, pestaña Historial) —
// cualquiera de los tres roles de arriba.
export async function canViewMerchandiseReentry() {
  const session = await auth();
  if (!session) return false;
  if (session.user.role === "admin") return true;
  return (
    (await canCaptureMerchandiseReentry()) ||
    (await canApproveMerchandiseReentry()) ||
    (await canCloseMerchandiseReentry())
  );
}

// Versión genérica de getInventoryLeadId/getFinanceLeadId/getMarketingLeadId
// — sirve para CUALQUIER departamento por id, no solo INV/FIN/MKT. Agregado
// para el enrutamiento entre áreas del check-in semanal, que debe funcionar
// para todos los departamentos, no una lista fija corta.
export async function getDeptLeadId(deptId: string): Promise<string | null> {
  const lead = await prisma.user.findFirst({
    where: { isLeader: true, leadsDeptId: deptId, isActive: true },
    select: { id: true },
  });
  return lead?.id ?? null;
}

// Resuelve al líder del departamento AL QUE PERTENECE un usuario dado (no el
// que esa persona lidera) — usado cuando el check-in semanal nombra a un
// colaborador específico de otro equipo: se avisa a SU líder, nunca al
// colaborador directo, para que nadie reciba una tarea sin que su líder se
// entere.
export async function getLeadIdOfUsersDept(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { deptId: true } });
  if (!user?.deptId) return null;
  return getDeptLeadId(user.deptId);
}

// Check-in semanal — confirmado 2026-08-26: SOLO el líder de un área le
// reporta al asistente, no el resto del equipo (reemplaza la reunión 1:1
// que el admin tenía con cada líder, no una reunión con cada colaborador).
export async function canUseWeeklyCheckin() {
  const session = await auth();
  if (!session || session.user.role !== "employee") return false;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isLeader: true, leadsDeptId: true },
  });
  return !!user?.isLeader && !!user.leadsDeptId;
}

// Id de Nairoby (líder de Finanzas) para avisarle cuando Daniel aprueba un
// lote — mismo estilo que getInventoryLeadId.
export async function getFinanceLeadId(): Promise<string | null> {
  const lead = await prisma.user.findFirst({
    where: { isLeader: true, leadsDept: { code: "FIN" }, isActive: true },
    select: { id: true },
  });
  return lead?.id ?? null;
}

/**
 * ---------------- Registro de Egresos ----------------
 * Confirmado 2026-08-25, mismo espíritu que Reingreso de Mercadería: cualquier
 * miembro del equipo de Inventario captura (garantía/deterioro), solo Daniel
 * (líder de Inventario) resuelve deterioro y confirma la baja en Just — ni
 * siquiera admin, mismo criterio que canActOnMerchandiseReentry. Admin puede
 * VER el módulo (supervisión) igual que en el resto de flujos de Inventario.
 *
 * Confirmado 2026-08-31, pedido explícito del usuario: DESPACHO (la hoja de
 * despacho diaria) pasa a ser exclusivo de Daniel también — se gatea con
 * canActOnMerchandiseOutflow() en vez de canCaptureMerchandiseOutflow() en
 * cada endpoint/UI de esa razón, mismo patrón ya usado para CAMBIO_PROVEEDOR.
 * canCaptureMerchandiseOutflow() en sí no cambió (sigue siendo "todo el
 * equipo de Inventario") porque garantía/deterioro todavía la usan tal cual.
 */
export async function canCaptureMerchandiseOutflow() {
  const session = await auth();
  if (!session) return false;
  const user = await purchasesUserContext(session.user.id);
  if (!user) return false;
  return isInventoryTeamMember(user);
}

export async function canActOnMerchandiseOutflow() {
  const session = await auth();
  if (!session) return false;
  const user = await purchasesUserContext(session.user.id);
  if (!user) return false;
  return !!user.isLeader && user.leadsDept?.code === "INV";
}

export async function canViewMerchandiseOutflow() {
  const session = await auth();
  if (!session) return false;
  if (session.user.role === "admin") return true;
  return canCaptureMerchandiseOutflow();
}

// Confirmado 2026-08-27, pedido explícito del usuario: cuando un proveedor
// rechaza un cambio (ni cambia el producto ni da crédito), Nairoby es quien
// registra la pérdida en la parte financiera — a propósito SIN admin de
// respaldo (a diferencia del resto de guards de este módulo), porque el
// usuario fue explícito en que él solo mira esto en modo lectura, no actúa.
export async function canConfirmSupplierExchangeFinanceWriteOff() {
  const session = await auth();
  if (!session) return false;
  const user = await purchasesUserContext(session.user.id);
  if (!user) return false;
  return !!user.isLeader && user.leadsDept?.code === "FIN";
}

// Confirmado 2026-08-28, pedido explícito del usuario: revisar/comentar un
// rechazo total del proveedor (aviso urgente que ya recibe) es exclusivo del
// admin — es un registro de auditoría, no una tarea que gatee a Nairoby o
// Daniel (esas siguen corriendo en paralelo, sin depender de esto).
export async function canReviewSupplierExchangeRejection() {
  const session = await auth();
  return !!session && session.user.role === "admin";
}

// Confirmado 2026-08-25: id de Bryan (líder de Análisis de Mercado/MKT) para
// avisarle cuando Daniel escala un deterioro de mercadería reciente — mismo
// estilo que getInventoryLeadId/getFinanceLeadId.
export async function getMarketingLeadId(): Promise<string | null> {
  const lead = await prisma.user.findFirst({
    where: { isLeader: true, leadsDept: { code: "MKT" }, isActive: true },
    select: { id: true },
  });
  return lead?.id ?? null;
}

/**
 * ---------------- Ventas Externas (Fase 3 de Registro de Egresos) ----------------
 * Confirmado 2026-08-25: declarar es un flag delegado puntual (hoy Heidy,
 * Jariel, Yair, Marcos) — ninguno lidera Análisis de Mercado, mismo patrón
 * que canManagePurchases. Confirmar que llegó el pago es EXCLUSIVO del admin
 * (pedido explícito del usuario — "yo apruebo el recibido"). Facturar es de
 * Nairoby (líder de Finanzas). Agrupar/preparar reusa las guards de Registro
 * de Egresos (equipo de Inventario, Daniel exclusivo para asignar). Embalar
 * y entregar es del equipo de Fulfilment (Yair exclusivo para asignar).
 * Cerrar la venta es de Nairoby.
 *
 * Actualizado 2026-08-29, pedido explícito del usuario: aprobar/rechazar
 * quedó EXCLUSIVO de Bryan (líder de Análisis de Mercado) — a diferencia del
 * resto de este módulo, acá NI SIQUIERA ADMIN tiene el botón; admin
 * mantiene visibilidad total en modo lectura vía canViewExternalSales.
 */
export async function canDeclareExternalSales() {
  const session = await auth();
  if (!session) return false;
  if (session.user.role === "admin") return true;
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { canDeclareExternalSales: true } });
  return !!user?.canDeclareExternalSales;
}

export async function canReviewExternalSales() {
  const session = await auth();
  if (!session) return false;
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { isLeader: true, leadsDept: { select: { code: true } } } });
  return !!user?.isLeader && user.leadsDept?.code === "MKT";
}

export async function canConfirmExternalSalePayment() {
  const session = await auth();
  return !!session && session.user.role === "admin";
}

// Nairoby sube la factura (obligatoria en pago anticipado, opcional en
// contra entrega) — mismo criterio de liderazgo de Finanzas que el cierre.
export async function canInvoiceExternalSale() {
  const session = await auth();
  if (!session) return false;
  if (session.user.role === "admin") return true;
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { isLeader: true, leadsDept: { select: { code: true } } } });
  return !!user?.isLeader && user.leadsDept?.code === "FIN";
}

// Yair (líder de Fulfilment) asigna a su equipo quién embala y entrega —
// mismo patrón que canActOnMerchandiseOutflow pero para el departamento FUL.
// Confirmado 2026-08-29: Yair es a la vez asesor (declara ventas del canal
// Shanghai) y líder de este equipo — los dos roles conviven.
export async function canAssignExternalSalePack() {
  const session = await auth();
  if (!session) return false;
  if (session.user.role === "admin") return true;
  const user = await purchasesUserContext(session.user.id);
  if (!user) return false;
  return !!user.isLeader && user.leadsDept?.code === "FUL";
}

export async function canPackExternalSale() {
  const session = await auth();
  if (!session) return false;
  const user = await purchasesUserContext(session.user.id);
  if (!user) return false;
  return isFulfilmentTeamMember(user);
}

export async function canCloseExternalSale() {
  const session = await auth();
  if (!session) return false;
  if (session.user.role === "admin") return true;
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { isLeader: true, leadsDept: { select: { code: true } } } });
  return !!user?.isLeader && user.leadsDept?.code === "FIN";
}

/**
 * ---------------- Guías Canceladas (Fase 4 de Registro de Egresos) ----------------
 * Confirmado 2026-08-25: lo sube cualquiera de Análisis de Mercado (MKT) o
 * Fulfillment (FUL) — sin exigir liderazgo, mismo criterio de membresía de
 * equipo que Reingreso/Egresos.
 *
 * Rediseñado 2026-09-02 (ver docblock de CancelledGuideReport en el
 * schema): las confirmaciones separadas de Fulfillment/Inventario y el
 * corte semanal de Bryan quedaron reemplazadas por
 * canManageCancelledGuideBatches (Bryan gestiona el lote completo con la
 * transportadora/Dropi) + canAssignCancelledGuideItems (delegado puntual,
 * hoy Heidy, carga los productos de cada guía). Reingresar a Just sigue
 * siendo de Daniel (reusa canActOnMerchandiseOutflow, mismo Daniel
 * exclusivo).
 *
 * Agregado 2026-09-03, pedido explícito del usuario: entre Bryan y Daniel
 * se sumó canConfirmCancelledGuideFulfillmentRemoval (Yair, líder FUL,
 * confirma que sacó las guías gestionadas del área de Fulfillment antes de
 * que se despachen) — mismo criterio de liderazgo que Bryan/Daniel.
 */
async function cancelledGuideUserContext(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { isLeader: true, leadsDept: { select: { code: true } }, department: { select: { code: true } } },
  });
}

export async function canSubmitCancelledGuide() {
  const session = await auth();
  if (!session) return false;
  const user = await cancelledGuideUserContext(session.user.id);
  if (!user) return false;
  return user.department?.code === "MKT" || user.department?.code === "FUL";
}

// Bryan (líder MKT) confirma que gestionó un lote completo con la
// transportadora/Dropi — mismo criterio que el corte semanal que reemplaza.
export async function canManageCancelledGuideBatches() {
  const session = await auth();
  if (!session) return false;
  if (session.user.role === "admin") return true;
  const user = await cancelledGuideUserContext(session.user.id);
  return !!user?.isLeader && user.leadsDept?.code === "MKT";
}

// Agregado 2026-09-03, pedido explícito del usuario: Yair (líder FUL)
// confirma, después de que Bryan gestionó el lote, que ya sacó esas guías
// del área de Fulfillment para que no se despachen. Mismo criterio que
// canManageCancelledGuideBatches (admin también puede).
export async function canConfirmCancelledGuideFulfillmentRemoval() {
  const session = await auth();
  if (!session) return false;
  if (session.user.role === "admin") return true;
  const user = await cancelledGuideUserContext(session.user.id);
  return !!user?.isLeader && user.leadsDept?.code === "FUL";
}

// Delegado puntual (hoy Heidy) que carga productos/cantidades guía por
// guía una vez que Bryan confirmó el lote — mismo patrón EXCLUSIVO de
// canConfirmMarketingDesign/Advisor, ni siquiera admin actúa acá.
export async function canAssignCancelledGuideItems() {
  const session = await auth();
  if (!session || session.user.role === "admin") return false;
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { canAssignCancelledGuideItems: true } });
  return !!user?.canAssignCancelledGuideItems;
}

// Ve TODAS las solicitudes (no solo las propias) — líderes de MKT/FUL/INV y
// admin, pedido explícito del usuario ("Bryan sepa todas las guías...").
export async function canViewAllCancelledGuides() {
  const session = await auth();
  if (!session) return false;
  if (session.user.role === "admin") return true;
  const user = await cancelledGuideUserContext(session.user.id);
  return !!user?.isLeader && !!user.leadsDept && ["MKT", "FUL", "INV"].includes(user.leadsDept.code);
}

export async function canViewCancelledGuides() {
  const session = await auth();
  if (!session) return false;
  if (session.user.role === "admin") return true;
  return (
    (await canSubmitCancelledGuide()) ||
    (await canViewAllCancelledGuides()) ||
    (await canManageCancelledGuideBatches()) ||
    (await canConfirmCancelledGuideFulfillmentRemoval()) ||
    (await canAssignCancelledGuideItems()) ||
    (await canCaptureMerchandiseOutflow())
  );
}

// Visibilidad general de la pestaña — cualquiera de los roles del flujo.
export async function canViewExternalSales() {
  const session = await auth();
  if (!session) return false;
  if (session.user.role === "admin") return true;
  return (
    (await canDeclareExternalSales()) ||
    (await canReviewExternalSales()) ||
    (await canCloseExternalSale()) ||
    (await canCaptureMerchandiseOutflow()) ||
    (await canPackExternalSale())
  );
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
// Confirmado 2026-08-28: también visible, en modo solo lectura, para quien
// tenga canViewMarketingArrivalsForDispatch (hoy Yair) aunque no sea de MKT —
// mismo escape hatch "sin dept.code" que canManagePurchases.
export async function canViewMarketingArrivals() {
  const session = await auth();
  if (!session) return false;
  if (session.user.role === "admin") return true;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { department: { select: { code: true } }, canViewMarketingArrivalsForDispatch: true },
  });
  if (user?.canViewMarketingArrivalsForDispatch) return true;
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

// Sugerencias de Combos (ATOM + baja rotación) — confirmado 2026-08-31, idea
// diseñada en conversación larga (ver memoria
// project_atom_combo_suggestions_idea). Ver/seleccionar sugerencias es todo
// el equipo de Análisis de Mercado (hoy incluye a Jariel y Heidy, mismo
// dept.code === "MKT" que canViewMarketingArrivals arriba); aprobar el lote
// es exclusivo de quien lidera MKT (hoy Bryan Ríos) — el guard nunca depende
// del nombre, solo de dept.code/leadsDept.code, para que siga funcionando si
// cambia el roster.
export async function canViewComboSuggestions() {
  const session = await auth();
  if (!session) return false;
  if (session.user.role === "admin") return true;
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { department: { select: { code: true } } } });
  return user?.department?.code === "MKT";
}

export async function canApproveComboSuggestions() {
  const session = await auth();
  if (!session) return false;
  if (session.user.role === "admin") return true;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isLeader: true, leadsDept: { select: { code: true } } },
  });
  return !!user?.isLeader && user.leadsDept?.code === "MKT";
}

// Confirmado 2026-09-04: pedido explícito del usuario (Andrés, admin) —
// aprobar/rechazar un lote de combos queda EXCLUSIVO de Bryan (líder de
// Análisis de Mercado), ni siquiera admin. canApproveComboSuggestions sigue
// siendo el gate de "ver la cola de aprobación" (admin la sigue viendo, en
// modo lectura); este guard nuevo es el único que autoriza la acción real.
export async function canActOnComboSuggestions() {
  const session = await auth();
  if (!session) return false;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isLeader: true, leadsDept: { select: { code: true } } },
  });
  return !!user?.isLeader && user.leadsDept?.code === "MKT";
}

// Sube/actualiza la lista semanal de productos con menos de 8 despachos —
// mismo criterio que canManageJustCatalog (líder de Inventario, hoy Daniel).
export async function canUploadLowRotationList() {
  const session = await auth();
  if (!session) return false;
  if (session.user.role === "admin") return true;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isLeader: true, leadsDept: { select: { code: true } } },
  });
  return !!user?.isLeader && user.leadsDept?.code === "INV";
}

// Registra lo extraído de ATOM (lectura manual en vivo, lunes/miércoles/
// viernes) — mismo grupo que ve las sugerencias.
export async function canSyncAtomData() {
  return canViewComboSuggestions();
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

// Feedback de Liderazgo 360° (confirmado 2026-09-01) — quién puede calificar
// el Liderazgo de un líder (su propio equipo) vs. quién solo puede dejarle
// una observación libre (cualquiera de otra área). Nunca el admin ni el
// propio líder.
export async function canRateLeaderLeadership(leaderId: string) {
  const session = await auth();
  if (!session || session.user.role !== "employee") return false;

  const leader = await prisma.user.findUnique({ where: { id: leaderId }, select: { isLeader: true, leadsDeptId: true } });
  if (!leader?.isLeader) return false;

  const me = await prisma.user.findUnique({ where: { id: session.user.id }, select: { isLeader: true, deptId: true } });
  return !!me && !me.isLeader && me.deptId === leader.leadsDeptId;
}

export async function canObserveLeader(leaderId: string) {
  const session = await auth();
  if (!session || session.user.role !== "employee") return false;

  const leader = await prisma.user.findUnique({ where: { id: leaderId }, select: { isLeader: true, leadsDeptId: true } });
  if (!leader?.isLeader) return false;

  const me = await prisma.user.findUnique({ where: { id: session.user.id }, select: { isLeader: true, deptId: true } });
  return !!me && !me.isLeader && me.deptId !== leader.leadsDeptId;
}
