import { NextRequest, NextResponse } from "next/server";
import { getAllPendingTasksActors, getPendingTasksForActor } from "@/lib/pendingTasks";
import { sendPushToOwner } from "@/lib/webPush";

// Disparado por Vercel Cron (ver vercel.json) una vez al día. Protegido por
// CRON_SECRET para que nadie más pueda llamarlo desde afuera y disparar
// notificaciones falsas. Confirmado 2026-07-28: si el pendiente sigue sin
// resolverse, se vuelve a avisar al día siguiente (no hay "ya te avisé, no
// insisto más") — mismo espíritu que un recordatorio real, no spam.
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const actors = await getAllPendingTasksActors();
  let notified = 0;

  for (const { ownerId, actor } of actors) {
    const tasks = await getPendingTasksForActor(actor);
    if (!tasks || tasks.items.length === 0) continue;

    const first = tasks.items[0];
    const body =
      tasks.items.length === 1
        ? `${first.label} — ${first.meta}`
        : `${first.label} — ${first.meta} (+${tasks.items.length - 1} más)`;

    await sendPushToOwner(ownerId, {
      title: `DAFLOW · ${tasks.title}`,
      body,
      url: first.href,
    });
    notified++;
  }

  return NextResponse.json({ ok: true, checked: actors.length, notified });
}
