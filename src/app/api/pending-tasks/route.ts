import { NextResponse } from "next/server";
import { getPendingTasksForCurrentUser } from "@/lib/pendingTasks";

export async function GET() {
  const result = await getPendingTasksForCurrentUser();
  return NextResponse.json(result);
}
