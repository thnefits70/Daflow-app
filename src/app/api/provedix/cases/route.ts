import { NextResponse } from "next/server";
import { getCasesRole, listAnswers, listCases } from "@/lib/provedixCases";

// Casos que Michelle IA pasó a Michelle (la asesora humana) + respuestas aprendidas (2026-10-15).
export async function GET() {
  if (!(await getCasesRole()))
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const [cases, answers] = await Promise.all([listCases(), listAnswers()]);
  return NextResponse.json({ cases, answers });
}
