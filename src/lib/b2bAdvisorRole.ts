import { prisma } from "@/lib/prisma";
import { B2B_ADVISOR_ROLE_FLAGS, B2B_ADVISOR_TITLES, DEFAULT_B2B_ADVISOR_TITLE, b2bAdvisorWithArticle } from "@/lib/b2bAdvisorRoleShared";

// Confirmado 2026-09-30, pedido explícito del usuario: el rol "Asesor(a) B2B"
// agrupa todo lo que hacía Heidy Morales hasta que se dio de baja. Jariel lo
// tiene provisionalmente hasta que entre la nueva persona; ese día se le
// activa el rol a ella desde su perfil en Nómina y a Jariel se le quita solo.
//
// El rol NO reemplaza los flags: los enciende. Todo el resto de la app
// (guards, avisos, pendientes) sigue leyendo cada flag como siempre. Lo que
// el rol agrega es (1) prenderlos todos de una vez, (2) recordar cuáles
// prendió él (b2bAdvisorGrantedFlags) para apagar solo esos al quitarlo, y
// (3) que haya una sola persona con el rol.
export { B2B_ADVISOR_ROLE_FLAGS, B2B_ADVISOR_TITLES, DEFAULT_B2B_ADVISOR_TITLE, b2bAdvisorWithArticle };

// Heidy estaba en Análisis de Mercado: proponer productos, ver Sugerencias de
// Combos, llegadas de mercadería, subir guías canceladas, proveedores, etc.
// salen de pertenecer a ese departamento, así que el rol también la deja ahí.
const B2B_ADVISOR_DEPT_CODE = "MKT";

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function revokeFrom(tx: Tx, userId: string) {
  const u = await tx.user.findUnique({ where: { id: userId }, select: { b2bAdvisorGrantedFlags: true } });
  if (!u) return;
  const off: Record<string, boolean> = {};
  for (const f of u.b2bAdvisorGrantedFlags) if ((B2B_ADVISOR_ROLE_FLAGS as readonly string[]).includes(f)) off[f] = false;
  await tx.user.update({
    where: { id: userId },
    data: { ...off, isB2BAdvisor: false, b2bAdvisorProvisional: false, b2bAdvisorTitle: null, b2bAdvisorGrantedFlags: [] },
  });
}

// Asigna el rol a userId y se lo quita a quien lo tuviera. Devuelve el nombre
// de quien lo tenía (para avisarlo en pantalla).
export async function assignB2BAdvisorRole(userId: string, opts: { title: string; provisional: boolean }) {
  return prisma.$transaction(async (tx) => {
    const previous = await tx.user.findMany({ where: { isB2BAdvisor: true, id: { not: userId } }, select: { id: true, name: true } });
    for (const p of previous) await revokeFrom(tx, p.id);

    const me = await tx.user.findUnique({
      where: { id: userId },
      select: { isB2BAdvisor: true, b2bAdvisorGrantedFlags: true, deptId: true, ...Object.fromEntries(B2B_ADVISOR_ROLE_FLAGS.map((f) => [f, true])) },
    });
    if (!me) throw new Error("Usuario no encontrado.");
    const row = me as unknown as Record<string, boolean>;
    // Si ya tenía el rol, conserva lo que el rol prendió antes.
    const granted = new Set<string>(me.isB2BAdvisor ? me.b2bAdvisorGrantedFlags : []);
    const on: Record<string, boolean> = {};
    for (const f of B2B_ADVISOR_ROLE_FLAGS) {
      if (!row[f]) {
        on[f] = true;
        granted.add(f);
      }
    }
    const mkt = await tx.department.findFirst({ where: { code: B2B_ADVISOR_DEPT_CODE }, select: { id: true } });
    const movedToMkt = !!mkt && me.deptId !== mkt.id;
    await tx.user.update({
      where: { id: userId },
      data: {
        ...on,
        ...(movedToMkt ? { deptId: mkt!.id } : {}),
        isB2BAdvisor: true,
        b2bAdvisorTitle: opts.title,
        b2bAdvisorProvisional: opts.provisional,
        b2bAdvisorGrantedFlags: [...granted],
      },
    });
    return { previousHolders: previous.map((p) => p.name), movedToMkt };
  });
}

export async function revokeB2BAdvisorRole(userId: string) {
  await prisma.$transaction((tx) => revokeFrom(tx, userId));
}

// Cómo se llama el rol hoy ("Asesora B2B" / "Asesor B2B"), según quien lo
// tenga. Sin nadie con el rol, el femenino por defecto.
export async function getB2BAdvisorTitle(): Promise<string> {
  const u = await prisma.user.findFirst({ where: { isB2BAdvisor: true, isActive: true }, select: { b2bAdvisorTitle: true } });
  return u?.b2bAdvisorTitle || DEFAULT_B2B_ADVISOR_TITLE;
}
