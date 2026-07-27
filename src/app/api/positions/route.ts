import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/guards";

// Lista todos los cargos ya registrados en Nómina (catálogo Position, por
// departamento) — usado como sugerencias al nombrar una ruta de conocimiento,
// para reutilizar el mismo nombre de cargo en vez de escribirlo de nuevo cada
// vez, sin que la ruta quede realmente ligada a ese departamento.
export async function GET() {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const positions = await prisma.position.findMany({
    include: { dept: { select: { name: true } } },
    orderBy: [{ dept: { order: "asc" } }, { name: "asc" }],
  });

  return NextResponse.json(
    positions.map((p) => ({ id: p.id, name: `${p.name} · ${p.dept.name}` }))
  );
}
