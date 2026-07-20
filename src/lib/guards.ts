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
