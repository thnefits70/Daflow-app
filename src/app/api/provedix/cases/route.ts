import { NextResponse } from "next/server";
import { getCasesRole, listAnswers, listCases } from "@/lib/provedixCases";

// Casos que Michelle IA pasó a Michelle (la asesora humana) + respuestas aprendidas (2026-10-15).
export async function GET() {
  const role = await getCasesRole();
  if (!role)
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  // Cada quien ve los casos de su plataforma (Michelle: Dropi, Yair: Rocket, admin: todos).
  const [cases, answers] = await Promise.all([listCases(role.platforms), listAnswers()]);
  return NextResponse.json({ cases, answers });
}
