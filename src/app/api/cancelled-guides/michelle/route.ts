import { NextResponse } from "next/server";
import {
  getMichelleCancelRole,
  listMichelleCancellations,
} from "@/lib/michelleCancellations";

// Guías canceladas pedidas por el dropshipper en el chat de Michelle (2026-10-15).
export async function GET() {
  const role = await getMichelleCancelRole();
  if (!role)
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  return NextResponse.json({
    rows: await listMichelleCancellations(),
    canDecide: role.canDecide,
    canRetain: role.canRetain,
  });
}
