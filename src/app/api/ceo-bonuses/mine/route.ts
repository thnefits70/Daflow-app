import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

// Historial privado del propio destinatario — "Mis bonos", nunca visible a
// nadie más que la propia persona (y Nairoby/admin en la ruta for-nairoby).
export async function GET() {
  const session = await auth();
  if (!session || session.user.role === "admin") return NextResponse.json([]);

  const grants = await prisma.ceoBonusGrant.findMany({
    where: { userId: session.user.id },
    orderBy: { grantedAt: "desc" },
  });
  return NextResponse.json(grants);
}
