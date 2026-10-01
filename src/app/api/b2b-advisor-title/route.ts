import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getB2BAdvisorTitle } from "@/lib/b2bAdvisorRole";

// Cómo se llama hoy el rol ("Asesora B2B" / "Asesor B2B") según quien lo
// tenga — para los textos de pantalla que antes decían "Heidy". Solo el
// título, nunca quién lo tiene.
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  return NextResponse.json({ title: await getB2BAdvisorTitle() });
}
