import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { privateFileUrl } from "@/lib/privateFiles";
import {
  canConfirmPersonalPurchaseFinance,
  canConfirmPersonalPurchaseInventory,
  canManageNomina,
  canManagePayroll,
  canViewPayrollMessages,
  canViewPayrollRoles,
  canViewSalaryAdvancesHistory,
} from "@/lib/guards";

// Quién puede abrir un documento privado (pedido del usuario 2026-10-12:
// "solo debe abrir lo que le pertenece y no otro de otro usuario").
//
// Documentos PERSONALES: solo la persona dueña + quien maneja nómina
// (líder de Finanzas) y el admin, con el mismo criterio que ya usan esas
// pantallas. Quien subió el archivo también lo puede ver (para la vista
// previa justo después de subirlo, antes de guardar): las subidas nuevas
// llevan su id en la ruta (<carpeta>/<usuario>/<archivo>).
//
// Documentos de PROCESO (guías, compras, Caja Chica, facturas…) no son de
// una persona: los abre cualquier colaborador con sesión, como antes.

type Rule = (url: string, me: string) => Promise<boolean>;

const PERSONAL: Record<string, Rule> = {
  "pay-stubs": async (url, me) => {
    const r = await prisma.payStub.findFirst({ where: { fileUrl: url }, select: { userId: true } });
    return r?.userId === me || (await canManagePayroll());
  },
  cvs: async (url, me) => {
    const r = await prisma.user.findFirst({ where: { cvUrl: url }, select: { id: true } });
    return r?.id === me || (await canManageNomina());
  },
  "payroll-individual-payment-proofs": async (url, me) => {
    const [m, q] = await Promise.all([
      prisma.monthlyLegalRole.findFirst({ where: { payoutProofUrl: url }, select: { employeeId: true } }),
      prisma.payrollQuincenaRole.findFirst({ where: { paidProofUrl: url }, select: { employeeId: true } }),
    ]);
    return m?.employeeId === me || q?.employeeId === me || (await canViewPayrollRoles());
  },
  "payroll-transfer-proofs": async () => canViewPayrollRoles(),
  "salary-advance-proofs": async (url, me) => {
    const r = await prisma.salaryAdvance.findFirst({ where: { transferProofUrl: url }, select: { employeeId: true } });
    return r?.employeeId === me || (await canViewSalaryAdvancesHistory()) || (await canViewPayrollRoles());
  },
  "payroll-message-attachments": async (url) => {
    const r = await prisma.payrollMessage.findFirst({ where: { attachmentUrl: url }, select: { employeeId: true } });
    return r ? canViewPayrollMessages(r.employeeId) : canViewPayrollRoles();
  },
  "personal-purchase-proofs": async (url, me) => {
    const r = await prisma.personalPurchaseOrder.findFirst({ where: { transferProofUrl: url }, select: { employeeId: true } });
    return r?.employeeId === me || (await canConfirmPersonalPurchaseFinance()) || (await canConfirmPersonalPurchaseInventory());
  },
  "mismanagement-evidence": async (url, me) => {
    const r = await prisma.managementDeduction.findFirst({ where: { evidenceUrl: url }, select: { employeeId: true } });
    return r?.employeeId === me || (await canViewPayrollRoles());
  },
};

export async function canOpenPrivateFile(path: string): Promise<boolean> {
  const session = await auth();
  if (!session) return false;
  const [folder, maybeUser] = path.split("/");
  const rule = PERSONAL[folder];
  if (!rule) return true; // documento de proceso: cualquier colaborador con sesión
  if (session.user.role === "admin") return true;
  if (maybeUser === session.user.id) return true; // lo subió esta persona
  return rule(privateFileUrl(path), session.user.id);
}

// Carpetas personales: las subidas nuevas guardan el id de quien sube en la
// ruta (ver /api/upload/sign).
export const PERSONAL_PRIVATE_FOLDERS = new Set(Object.keys(PERSONAL));
