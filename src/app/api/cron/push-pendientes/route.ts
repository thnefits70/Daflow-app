import { NextRequest, NextResponse } from "next/server";
import { getAllPendingTasksActors, getPendingTasksForActor } from "@/lib/pendingTasks";
import { getDisabledTypes } from "@/lib/pushPreferences";
import { getDuePersonalReminderPushes } from "@/lib/periodicReminders";
import { getStalePurchaseRequestPushes } from "@/lib/purchases";
import { sendPushToOwner } from "@/lib/webPush";

// Disparado por Vercel Cron (ver vercel.json) una vez al día. Protegido por
// CRON_SECRET para que nadie más pueda llamarlo desde afuera y disparar
// notificaciones falsas. Confirmado 2026-07-28: si el pendiente sigue sin
// resolverse, se vuelve a avisar al día siguiente (no hay "ya te avisé, no
// insisto más") — mismo espíritu que un recordatorio real, no spam.
//
// Limitación conocida del plan Hobby de Vercel: los crons solo corren una
// vez al día, así que los "Recordatorios" personales con hora específica
// (timeOfDay) se avisan una sola vez por día si ya están vencidos, sin
// respetar la hora exacta configurada — para eso haría falta un plan de
// pago con crons más frecuentes.
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

    // Confirmado 2026-07-28: cada quien puede apagar tipos puntuales de
    // pendiente (ej. "Pagos recordatorios" sí, "Roles de pago" no) — se
    // filtra aquí, no en getPendingTasksForActor, porque la tarjeta de
    // Pendientes dentro de DAFLOW debe seguir mostrando todo siempre; la
    // preferencia solo decide qué se manda como notificación externa.
    const disabled = await getDisabledTypes(ownerId);
    const notifiable = tasks.items.filter((i) => !disabled.has(i.type));
    if (notifiable.length === 0) continue;

    const first = notifiable[0];
    const body =
      notifiable.length === 1
        ? `${first.label} — ${first.meta}`
        : `${first.label} — ${first.meta} (+${notifiable.length - 1} más)`;

    await sendPushToOwner(ownerId, {
      title: `DAFLOW · ${tasks.title}`,
      body,
      url: first.href,
    });
    notified++;
  }

  const personalReminders = await getDuePersonalReminderPushes();
  for (const r of personalReminders) {
    await sendPushToOwner(r.ownerId, { title: r.title, body: r.body, url: r.url });
    notified++;
  }

  const stalePurchases = await getStalePurchaseRequestPushes();
  for (const r of stalePurchases) {
    await sendPushToOwner(r.ownerId, { title: r.title, body: r.body, url: r.url });
    notified++;
  }

  return NextResponse.json({ ok: true, checked: actors.length, notified });
}
