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
