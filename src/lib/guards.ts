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
// or anyone in that specific department, but only admin can write to it —
// checked separately at the route level with requireAdminSession().
export async function canViewDeptReview(deptId: string) {
  const session = await auth();
  if (!session) return false;
  if (session.user.role === "admin") return true;
  return session.user.deptId === deptId;
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
