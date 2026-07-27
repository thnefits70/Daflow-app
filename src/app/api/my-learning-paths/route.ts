import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getMyLearningPaths } from "@/lib/learningPaths";

export async function GET() {
  const session = await auth();
  if (!session || session.user.role !== "employee") {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const paths = await getMyLearningPaths(session.user.id);
  return NextResponse.json(paths);
}
